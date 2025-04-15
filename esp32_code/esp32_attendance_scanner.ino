#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h> // Make sure to install this library

// WiFi credentials
const char* ssid = "Vivo35";
const char* password = "puru1375";

// Backend server details
const char* serverAddress = "http://192.168.194.37:3000/api/mark_attendance"; // Replace with your server IP

// BLE scan config
BLEScan* pBLEScan;
int scanTime = 5; // seconds

// Student struct
struct Student {
    String name;
    String roll;
    String mac;
};

// Manually defined student list (for testing - replace with database interaction later)
std::vector<Student> studentList = {
    {"purvanshu", "101", "48:8A:E8:09:7D:6E"},
};

void sendAttendanceData(DynamicJsonDocument& jsonDocument) {
  HTTPClient http;
  String jsonData;

  serializeJson(jsonDocument, jsonData);

  Serial.print("Connecting to server: ");
  Serial.println(serverAddress);

  http.begin(serverAddress);
  http.addHeader("Content-Type", "application/json");

  Serial.print("Sending data: ");
  Serial.println(jsonData);

  int httpResponseCode = http.POST(jsonData);

  if (httpResponseCode > 0) {
      Serial.printf("HTTP Response code: %d\n", httpResponseCode);
      String response = http.getString();
      Serial.println(response);
  } else {
      Serial.printf("HTTP request failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
  }

  http.end();
}

void setup() {
    Serial.begin(115200);

    Serial.println("Initializing BLE...");
    BLEDevice::init("");
    pBLEScan = BLEDevice::getScan();
    pBLEScan->setActiveScan(true);


    // Connect to WiFi
    Serial.print("Connecting to WiFi...");
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi connected");
    Serial.println(WiFi.localIP());
}

void loop() {
  Serial.println("\n🔍 Scanning for nearby Bluetooth devices...");
  BLEScanResults results = pBLEScan->start(scanTime, false);
  int count = results.getCount();
  Serial.printf("📡 Found %d devices\n", count);

  DynamicJsonDocument jsonDoc(1024);
  JsonArray macAddresses = jsonDoc.createNestedArray("mac_addresses");

  for (int i = 0; i < count; i++) {
      BLEAdvertisedDevice device = results.getDevice(i);
      String mac = device.getAddress().toString().c_str();
      int rssi = device.getRSSI();

      if (rssi > -80) {
          for (const auto& student : studentList) {
              if (mac.equalsIgnoreCase(student.mac)) {
                  Serial.printf("✅ %s (%s) is Present [MAC: %s | RSSI: %d]\n",
                                student.name.c_str(), student.roll.c_str(), mac.c_str(), rssi);
                  macAddresses.add(student.mac);
                  break; // Assuming one MAC matches one student
              }
          }
      }
  }

  // Send the list of detected MAC addresses to the backend
  if (macAddresses.size() > 0) {
      sendAttendanceData(jsonDoc);
  } else {
      Serial.println("No known students found nearby.");
  }

  Serial.println("⏳ Waiting for next scan...");
  delay(10000);
}

