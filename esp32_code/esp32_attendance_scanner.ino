#include <WiFi.h>
#include <HTTPClient.h>
#include "BluetoothSerial.h" // For Classic Bluetooth discovery
#include <ArduinoJson.h>    // For creating JSON payloads

// --- Wi-Fi Configuration ---
const char* ssid = "Vivo35";         // Replace with your Wi-Fi SSID
const char* password = "puru1375"; // Replace with your Wi-Fi Password

// --- Server Configuration ---
const char* serverUrl = "http://192.168.190.37:3000/api/mark_attendance"; // Replace

// --- Bluetooth Discovery ---
BluetoothSerial SerialBT;
BTScanResults* btDeviceList; // To store discovered devices

// --- Timing ---
unsigned long lastScanTime = 0;
const long scanInterval = 60000; // Scan every 60 seconds (60000 ms)
// Inquiry length is (discoveryDuration * 1.28s). 8 * 1.28s = ~10.24s
const uint8_t discoveryDurationUnits = 8; 


//======================================================================
// FUNCTION DEFINITIONS (Moved up)
//======================================================================

void connectToWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) { // Try for about 10 seconds
    delay(500);
    Serial.print(".");
    attempt++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFailed to connect to WiFi. Please check credentials or network.");
    while(true); // Halt on critical error
  }
}

void sendMacAddressesToServer(BTScanResults* devices) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected. Cannot send data.");
    connectToWiFi(); // Attempt to reconnect
    if (WiFi.status() != WL_CONNECTED) return; // Still not connected, exit
  }

  if (devices == nullptr || devices->getCount() == 0) {
    Serial.println("No devices in the list to send.");
    return;
  }

  HTTPClient http;
  
  // It's good practice to set a timeout for HTTP requests
  http.setTimeout(10000); // 10 seconds timeout

  if (!http.begin(serverUrl)) {
    Serial.println("Failed to initialize HTTP client with server URL.");
    return;
  }
  
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument jsonDoc(1024); 
  JsonArray macArray = jsonDoc.createNestedArray("mac_addresses");

  Serial.print("Found ");
  Serial.print(devices->getCount());
  Serial.println(" devices. Preparing to send:");

  for (int i = 0; i < devices->getCount(); i++) {
    BTAdvertisedDevice* device = devices->getDevice(i);
    if (device != nullptr) { // Defensive check
      String macAddress = device->getAddress().toString().c_str(); 
      macArray.add(macAddress); 
      Serial.println(" - " + macAddress + " (" + device->getName().c_str() + ")");
    }
  }

  if (macArray.size() == 0) {
    Serial.println("No valid MAC addresses collected to send.");
    http.end(); // Important to end the HTTP client session
    return;
  }

  String requestBody;
  serializeJson(jsonDoc, requestBody);

  Serial.println("Sending JSON to server: " + requestBody);

  int httpResponseCode = http.POST(requestBody);

  if (httpResponseCode > 0) {
    String responsePayload = http.getString();
    Serial.print("HTTP Response code: ");
    Serial.println(httpResponseCode);
    Serial.println("Response payload: " + responsePayload);
  } else {
    Serial.print("Error on sending POST: ");
    Serial.println(httpResponseCode);
    Serial.printf("HTTP POST failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
  }

  http.end(); // Important to end the HTTP client session
}

// Callback for when a new Bluetooth device is discovered (during async scan)
// This function IS a callback, so its position relative to where it's passed as a function pointer
// doesn't strictly matter for that call, but it's good practice to keep related functions together.
void btAdvertisedDeviceFoundCallback(BTAdvertisedDevice* pDevice) {
    Serial.printf("Async Found device: %s, MAC: %s, RSSI: %d\n", 
                  pDevice->getName().c_str(), 
                  pDevice->getAddress().toString().c_str(),
                  pDevice->getRSSI());
    // We don't send immediately here, we collect them and send after the scan period.
}


//======================================================================
// SETUP and LOOP
//======================================================================

void setup() {
  Serial.begin(115200);
  while (!Serial); // Wait for serial monitor to open (optional, for debugging)
  Serial.println("ESP32 Attendance Scanner Initializing...");

  connectToWiFi(); // Now declared above

  Serial.println("Initializing Bluetooth...");
  if (!SerialBT.begin("ESP32_Scanner")) { 
    Serial.println("An error occurred initializing Bluetooth!");
    while(true); // Halt
  }
  Serial.println("Bluetooth Initialized. Ready to scan.");
  SerialBT.enableSSP(); 
}

void loop() {
  unsigned long currentTime = millis();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Attempting to reconnect...");
    connectToWiFi();
    if (WiFi.status() != WL_CONNECTED) {
        delay(5000); // Wait before retrying WiFi if connection failed
        return;      // Skip scan if WiFi is down
    }
  }

  if (currentTime - lastScanTime >= scanInterval || lastScanTime == 0) { // Scan immediately on first run
    lastScanTime = currentTime;
    Serial.println("\nStarting Bluetooth Discovery Cycle...");

    // Clear previous scan results if any (important for memory management)
    if(btDeviceList != nullptr){
        SerialBT.discoverClear(); // Clears the internal list used by getScanResults
        btDeviceList = nullptr;   // Set our pointer to null
        Serial.println("Cleared previous scan results.");
    }

    // Start discovery (asynchronous)
    // Second parameter 'true' updates the already found devices with new info (like RSSI) if they are found again
    // Third parameter 'discoveryDurationUnits' is the inquiry length in 1.28sec units
    if (SerialBT.discoverAsync(btAdvertisedDeviceFoundCallback, discoveryDurationUnits)) {
        Serial.print("Async Discovery started for approx. ");
        Serial.print(discoveryDurationUnits * 1.28, 2);
        Serial.println(" seconds. Waiting for results...");
        
        // The callback btAdvertisedDeviceFoundCallback will be called for each device.
        // The discovery will stop automatically after `discoveryDurationUnits`.
        // We need to wait for it to complete before calling getScanResults().
        delay((discoveryDurationUnits * 1280) + 2000); // Wait for discovery duration + buffer

        Serial.println("Async Discovery finished. Retrieving list...");
        btDeviceList = SerialBT.getScanResults(); // Get the pointer to the internal list

        if (btDeviceList != nullptr && btDeviceList->getCount() > 0) {
          sendMacAddressesToServer(btDeviceList); // Now declared above
        } else {
          Serial.println("No Bluetooth devices found in this scan cycle.");
        }
        // No need to call SerialBT.discoverClear() immediately after getScanResults if we will
        // clear it at the beginning of the next scan cycle, as done above.
        // However, if memory is extremely tight, clear it here too.
        // SerialBT.discoverClear();
        // btDeviceList = nullptr;

    } else {
        Serial.println("Failed to start Bluetooth async discovery.");
    }
    Serial.println("End of Bluetooth Discovery Cycle.");
  }
  delay(1000); // Small delay in the main loop
}