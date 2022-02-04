const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const CONFIG_URL = path.join(__dirname, 'config.json');
const REGISTRY_URL = path.join(__dirname, 'registry.json');
const ALERTS_URL = path.join(__dirname, 'alerts.json');

exports.getConfig = () => readJSONFile(CONFIG_URL);

exports.getRegistry = () => readJSONFile(REGISTRY_URL);

exports.getAlerts = () => readJSONFile(ALERTS_URL);

exports.setConfig = (data) => writeJSONFile(CONFIG_URL, data);

exports.setRegistry = (data) => writeJSONFile(REGISTRY_URL, data);

exports.setAlerts = (data) => writeJSONFile(ALERTS_URL, data);

exports.buildCron = (seconds) => {
  return new Promise((resolve, reject) => {
    if (seconds === 0) {
      return `* * * * * *`;
    }
    let cronStr;
    let minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      cronStr = `*/${minutes} * * * *`;
    } else {
      cronStr = `*/${seconds} * * * * *`;
    }
    if (!cron.validate(cronStr)) {
      reject(`Invalid cron from ${seconds}s: ${cronStr}`)
    }
    resolve(cronStr);
  });
}

exports.validateInterval = (interval) => {
  return new Promise((resolve, reject) => {
    if (isNaN(interval)) {
      reject('Not an integer');
    }
    if (interval < 0) {
      reject('Must be positive');
    }
    if (interval > 86399) {
      reject('Only values up to 86399 are allowed.');
    }
    resolve(interval);
  })
}

const writeJSONFile = (filePath, data) => {
  return new Promise((resolve, reject) => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data));
      resolve();
    } catch(err) {
      reject(`Error saving data: ${err}`);
    }
  })
}

const readJSONFile = (src) => {
  return new Promise((resolve, reject) => {
    try {
      let data = fs.readFileSync(src);
      let json = JSON.parse(data);
      resolve(json);
    } catch(err) {
      reject(err);
    }
  })
}