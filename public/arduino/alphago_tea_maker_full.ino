#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Servo.h>

#define SS_PIN 10
#define RST_PIN A1

const int stepPin = 9;
const int dirPin = 6;
const int enablePin = 5;
const int waterPump = 4;
const int icedTeaPump = 8;
const int thirdDrinkPump = 7;
const int servoPin = 2;
const int lightSensor = A0;
const int buttonPin = 3;

const int defaultWaterSeconds = 15;
const int defaultTeaSeconds = 20;
const int defaultThirdDrinkSeconds = 20;
const int defaultLowerSteps = 4000;
const int defaultLiftSteps = 4500;
int cupThreshold = 500;

LiquidCrystal_I2C lcd(0x27, 16, 2);
MFRC522 rfid(SS_PIN, RST_PIN);
Servo mixerServo;

volatile bool isEmergency = false;
volatile unsigned long lastInterruptTime = 0;
bool lastCupState = false;
bool isBrewing = false;
unsigned long lastSensorLogAt = 0;

void reportStatus(const char* status) {
  Serial.print("STATUS:");
  Serial.println(status);
}

void lcdPrint(String line1, String line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1);
  lcd.print(line2.substring(0, 16));
}

void stopOutputs() {
  digitalWrite(waterPump, LOW);
  digitalWrite(icedTeaPump, LOW);
  digitalWrite(thirdDrinkPump, LOW);
  digitalWrite(enablePin, HIGH);
  mixerServo.write(90);
}

void emergencyStop() {
  if (digitalRead(buttonPin) == LOW) {
    unsigned long interruptTime = millis();
    if (interruptTime - lastInterruptTime > 200) {
      isEmergency = true;
    }
    lastInterruptTime = interruptTime;
  }
}

bool cupPresent() {
  return analogRead(lightSensor) >= cupThreshold;
}

bool checkEmergency() {
  if (!isEmergency) return false;
  stopOutputs();
  isBrewing = false;
  lcdPrint("EMERGENCY STOP", "Resetting");
  reportStatus("EMERGENCY");
  delay(1500);
  isEmergency = false;
  reportStatus("SYSTEM_READY");
  return true;
}

bool safeDelay(int ms) {
  int chunks = max(1, ms / 50);
  for (int i = 0; i < chunks; i++) {
    if (checkEmergency()) return true;
    delay(50);
  }
  return false;
}

void moveStepper(bool down, int steps) {
  digitalWrite(enablePin, LOW);
  digitalWrite(dirPin, down ? LOW : HIGH);
  for (int i = 0; i < steps; i++) {
    if (checkEmergency()) break;
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(800);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(800);
  }
  digitalWrite(enablePin, HIGH);
}

bool runTimedPumps(int waterMs, int teaMs, int thirdDrinkMs) {
  unsigned long startedAt = millis();
  bool waterOn = waterMs > 0;
  bool teaOn = teaMs > 0;
  bool thirdOn = thirdDrinkMs > 0;

  digitalWrite(waterPump, waterOn ? HIGH : LOW);
  digitalWrite(icedTeaPump, teaOn ? HIGH : LOW);
  digitalWrite(thirdDrinkPump, thirdOn ? HIGH : LOW);

  while (waterOn || teaOn || thirdOn) {
    if (checkEmergency()) return true;
    unsigned long elapsed = millis() - startedAt;
    if (waterOn && elapsed >= (unsigned long)waterMs) {
      digitalWrite(waterPump, LOW);
      waterOn = false;
    }
    if (teaOn && elapsed >= (unsigned long)teaMs) {
      digitalWrite(icedTeaPump, LOW);
      teaOn = false;
    }
    if (thirdOn && elapsed >= (unsigned long)thirdDrinkMs) {
      digitalWrite(thirdDrinkPump, LOW);
      thirdOn = false;
    }
    delay(30);
  }

  stopOutputs();
  return false;
}

void mixDrink() {
  reportStatus("MIXER_LOWERING");
  moveStepper(true, defaultLowerSteps);
  if (checkEmergency()) return;

  reportStatus("MIXING");
  for (int pos = 90; pos <= 180; pos++) {
    if (checkEmergency()) return;
    mixerServo.write(pos);
    delay(30);
  }

  for (int mix = 0; mix < 7; mix++) {
    for (int pos = 180; pos >= 130; pos -= 2) {
      if (checkEmergency()) return;
      mixerServo.write(pos);
      delay(12);
    }
    for (int pos = 130; pos <= 180; pos += 2) {
      if (checkEmergency()) return;
      mixerServo.write(pos);
      delay(12);
    }
  }

  if (safeDelay(2000)) return;

  for (int pos = 180; pos >= 90; pos--) {
    if (checkEmergency()) return;
    mixerServo.write(pos);
    delay(20);
  }

  reportStatus("LIFTING");
  moveStepper(false, defaultLiftSteps);
}

void makeDrink(String drinkName, int waterSeconds, int teaSeconds, int thirdDrinkSeconds, bool force) {
  if (isBrewing) {
    reportStatus("ERROR:BUSY");
    return;
  }
  if (!force && !cupPresent()) {
    reportStatus("ERROR:NO_CUP");
    lcdPrint("Place Cup", "Try Again");
    return;
  }

  isBrewing = true;
  lcdPrint(drinkName, "Brewing");
  reportStatus("DISPENSING");

  int waterMs = constrain(waterSeconds, 0, 90) * 1000;
  int teaMs = constrain(teaSeconds, 0, 90) * 1000;
  int thirdDrinkMs = constrain(thirdDrinkSeconds, 0, 90) * 1000;
  if (runTimedPumps(waterMs, teaMs, thirdDrinkMs)) return;

  if (!checkEmergency()) mixDrink();
  stopOutputs();

  if (!isEmergency) {
    lcdPrint("Done", "Enjoy :)");
    reportStatus("COMPLETE");
    safeDelay(2500);
    lcdPrint("Tea Maker Ready", "Place Cup");
    reportStatus("SYSTEM_READY");
  }
  isBrewing = false;
}

void makeIcedTea(int waterSeconds, int teaSeconds, int thirdDrinkSeconds, bool force) {
  makeDrink("Iced Tea", waterSeconds, teaSeconds, thirdDrinkSeconds, force);
}

void makeThirdDrink(int waterSeconds, int thirdDrinkSeconds, bool force) {
  makeDrink("Drink 3", waterSeconds, 0, thirdDrinkSeconds, force);
}

int commandPart(String command, int index, int fallback) {
  int start = 0;
  for (int i = 0; i < index; i++) {
    start = command.indexOf(',', start);
    if (start < 0) return fallback;
    start += 1;
  }
  int end = command.indexOf(',', start);
  String value = end < 0 ? command.substring(start) : command.substring(start, end);
  value.trim();
  return value.length() ? value.toInt() : fallback;
}

String commandTextPart(String command, int index, String fallback) {
  int start = 0;
  for (int i = 0; i < index; i++) {
    start = command.indexOf(',', start);
    if (start < 0) return fallback;
    start += 1;
  }
  int end = command.indexOf(',', start);
  String value = end < 0 ? command.substring(start) : command.substring(start, end);
  value.trim();
  return value.length() ? value : fallback;
}

void runSinglePump(int pin, int seconds, const char* status, bool force) {
  if (isBrewing) {
    reportStatus("ERROR:BUSY");
    return;
  }
  if (!force && !cupPresent()) {
    reportStatus("ERROR:NO_CUP");
    lcdPrint("Place Cup", "Try Again");
    return;
  }

  isBrewing = true;
  reportStatus(status);
  digitalWrite(pin, HIGH);
  safeDelay(constrain(seconds, 1, 90) * 1000);
  digitalWrite(pin, LOW);
  isBrewing = false;
  reportStatus("SYSTEM_READY");
}

void runStepperCommand(String direction, int steps) {
  reportStatus(direction == "DOWN" ? "MIXER_LOWERING" : "LIFTING");
  moveStepper(direction == "DOWN", constrain(steps, 1, 9000));
  reportStatus("SYSTEM_READY");
}

void cleanMachine(int waterSeconds, bool force) {
  if (isBrewing) {
    reportStatus("ERROR:BUSY");
    return;
  }
  if (!force && !cupPresent()) {
    reportStatus("ERROR:NO_CUP");
    lcdPrint("Place Cup", "For Clean");
    return;
  }

  isBrewing = true;
  lcdPrint("Cleaning", "Water Flush");
  reportStatus("CLEANING");
  digitalWrite(waterPump, HIGH);
  if (safeDelay(constrain(waterSeconds, 1, 120) * 1000)) return;
  digitalWrite(waterPump, LOW);

  if (!checkEmergency()) mixDrink();
  stopOutputs();
  isBrewing = false;

  lcdPrint("Clean Done", "Ready");
  reportStatus("CLEAN_COMPLETE");
  safeDelay(1200);
  lcdPrint("Tea Maker Ready", "Place Cup");
  reportStatus("SYSTEM_READY");
}

void cleanAllHoses(int seconds, bool force) {
  if (isBrewing) {
    reportStatus("ERROR:BUSY");
    return;
  }
  if (!force && !cupPresent()) {
    reportStatus("ERROR:NO_CUP");
    lcdPrint("Place Cup", "For Clean");
    return;
  }

  isBrewing = true;
  lcdPrint("Cleaning", "All Hoses");
  reportStatus("CLEANING_ALL");
  if (runTimedPumps(
    constrain(seconds, 1, 120) * 1000,
    constrain(seconds, 1, 120) * 1000,
    constrain(seconds, 1, 120) * 1000
  )) return;

  stopOutputs();
  isBrewing = false;
  lcdPrint("Clean Done", "Ready");
  reportStatus("CLEAN_COMPLETE");
  safeDelay(1200);
  lcdPrint("Tea Maker Ready", "Place Cup");
  reportStatus("SYSTEM_READY");
}

void handleCommand(String command) {
  command.trim();
  command.toUpperCase();
  if (!command.length()) return;

  Serial.print("CMD:");
  Serial.println(command);

  if (command == "PING" || command == "STATUS") {
    reportStatus(cupPresent() ? "CUP_DETECTED" : "SYSTEM_READY");
    return;
  }
  if (command == "STOP") {
    isEmergency = true;
    checkEmergency();
    return;
  }
  if (command.startsWith("CUP,")) {
    cupThreshold = constrain(commandPart(command, 1, cupThreshold), 0, 1023);
    reportStatus("CONFIG_UPDATED");
    return;
  }
  if (command.startsWith("WATER,") || command.startsWith("FORCE_WATER,")) {
    runSinglePump(waterPump, commandPart(command, 1, defaultWaterSeconds), "DISPENSING:WATER", command.startsWith("FORCE_WATER,"));
    return;
  }
  if (command.startsWith("TEA,") || command.startsWith("FORCE_TEA,")) {
    runSinglePump(icedTeaPump, commandPart(command, 1, defaultTeaSeconds), "DISPENSING:TEA", command.startsWith("FORCE_TEA,"));
    return;
  }
  if (command.startsWith("THIRD,") || command.startsWith("DRINK3_PUMP,") || command.startsWith("FORCE_THIRD,")) {
    runSinglePump(thirdDrinkPump, commandPart(command, 1, defaultThirdDrinkSeconds), "DISPENSING:DRINK3", command.startsWith("FORCE_THIRD,"));
    return;
  }
  if (command.startsWith("SERVO,")) {
    mixerServo.write(constrain(commandPart(command, 1, 90), 0, 180));
    reportStatus("SERVO_UPDATED");
    return;
  }
  if (command.startsWith("STEPPER,")) {
    runStepperCommand(commandTextPart(command, 1, "UP"), commandPart(command, 2, 800));
    return;
  }
  if (command == "CLEAN" || command == "RINSE" || command == "FORCE_CLEAN") {
    cleanMachine(10, command == "FORCE_CLEAN");
    return;
  }
  if (command == "CLEAN_ALL" || command == "FORCE_CLEAN_ALL") {
    cleanAllHoses(10, command == "FORCE_CLEAN_ALL");
    return;
  }
  if (command.startsWith("CLEAN,") || command.startsWith("RINSE,") || command.startsWith("FORCE_CLEAN,")) {
    cleanMachine(commandPart(command, 1, 10), command.startsWith("FORCE_CLEAN,"));
    return;
  }
  if (command.startsWith("CLEAN_ALL,") || command.startsWith("FORCE_CLEAN_ALL,")) {
    cleanAllHoses(commandPart(command, 1, 10), command.startsWith("FORCE_CLEAN_ALL,"));
    return;
  }
  if (command == "MIX") {
    mixDrink();
    reportStatus("SYSTEM_READY");
    return;
  }
  if (command.startsWith("SLEEP,")) {
    safeDelay(constrain(commandPart(command, 1, 1000), 1, 60000));
    reportStatus("SYSTEM_READY");
    return;
  }
  if (command.startsWith("T,") || command.startsWith("FORCE,")) {
    bool force = command.startsWith("FORCE,");
    int waterSeconds = commandPart(command, 1, defaultWaterSeconds);
    int teaSeconds = commandPart(command, 2, defaultTeaSeconds);
    int thirdDrinkSeconds = commandPart(command, 3, 0);
    makeIcedTea(waterSeconds, teaSeconds, thirdDrinkSeconds, force);
    return;
  }
  if (command.startsWith("D3,") || command.startsWith("FORCE_D3,") || command.startsWith("DRINK3,")) {
    bool force = command.startsWith("FORCE_D3,");
    int waterSeconds = commandPart(command, 1, defaultWaterSeconds);
    int thirdDrinkSeconds = commandPart(command, 2, defaultThirdDrinkSeconds);
    makeThirdDrink(waterSeconds, thirdDrinkSeconds, force);
    return;
  }

  reportStatus("ERROR:UNKNOWN_COMMAND");
}

void setup() {
  Serial.begin(9600);
  pinMode(stepPin, OUTPUT);
  pinMode(dirPin, OUTPUT);
  pinMode(enablePin, OUTPUT);
  pinMode(waterPump, OUTPUT);
  pinMode(icedTeaPump, OUTPUT);
  pinMode(thirdDrinkPump, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP);

  digitalWrite(enablePin, HIGH);
  digitalWrite(waterPump, LOW);
  digitalWrite(icedTeaPump, LOW);
  digitalWrite(thirdDrinkPump, LOW);

  mixerServo.attach(servoPin);
  mixerServo.write(90);

  SPI.begin();
  rfid.PCD_Init();
  lcd.init();
  lcd.backlight();
  attachInterrupt(digitalPinToInterrupt(buttonPin), emergencyStop, FALLING);

  lcdPrint("Tea Maker Ready", "Place Cup");
  reportStatus("SYSTEM_READY");
}

void loop() {
  if (checkEmergency()) return;

  if (Serial.available()) {
    handleCommand(Serial.readStringUntil('\n'));
    return;
  }

  bool currentCupState = cupPresent();
  if (millis() - lastSensorLogAt > 1500) {
    Serial.print("Light Sensor Value: ");
    Serial.println(analogRead(lightSensor));
    lastSensorLogAt = millis();
  }

  if (currentCupState != lastCupState) {
    lastCupState = currentCupState;
    if (currentCupState) {
      lcdPrint("Cup Detected", "Web or RFID");
      reportStatus("CUP_DETECTED");
    } else {
      lcdPrint("Tea Maker Ready", "Place Cup");
      reportStatus("SYSTEM_READY");
    }
  }

  if (!currentCupState || isBrewing) {
    delay(80);
    return;
  }

  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    reportStatus("RFID_DETECTED");
    makeIcedTea(defaultWaterSeconds, defaultTeaSeconds, 0, false);
    rfid.PICC_HaltA();
  }

  delay(50);
}
