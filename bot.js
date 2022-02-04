const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const Web3 = require('web3');
const utils = require('./utils');

const endpoint = process.env.ENV === 'DEVELOPMENT' ? process.env.DEV_WS : `${process.env.INFURA_WS}${process.env.INFURA_ID}`;
console.log("ENDPOINT", endpoint);
const provider = new Web3.providers.WebsocketProvider(endpoint);

if (web3 !== undefined) {
  web3.setProvider(provider);
} else {
  var web3 = new Web3(provider);
}
const bot = new TelegramBot(process.env.TBOT_TOKEN, {polling: true});

var task;

/**
 * PUBLIC COMMANDS
 */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, `Hello, please register with /register <your_name> <the_password>.`);
  return;
})

bot.onText(/\/register(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const args = match[1].trim().split(' ');
  if (args.length < 2) {
    return bot.sendMessage(chatId, `Please register with /register <your_name> <the_password>.`);
  }
  const name = args[0];
  const password = args[1];

  const chatIdStr = String(chatId);
  
  utils.getConfig().then(config => {
    if (password === config.password) {
      return utils.getRegistry();
    } else {
      throw new Error(`Incorrect password`);
    }
  }).then(data => {
    if (data[chatIdStr]) {
      bot.sendMessage(chatId, `You have already registered.`);
    } else {
      data[chatIdStr] = {
        name
      }
      return utils.setRegistry(data);
    }
  }).then(() => {
    bot.sendMessage(process.env.ADMIN_CHAT, `New user ${msg.chat.username}`);
    bot.sendMessage(chatId, `Hello ${name}! Set a maximum threshold with /setAlert <amount (integer) in Gwei> or get the current gas price with /getGasPrice`);
    return;
  }).catch(err => {
    bot.sendMessage(chatId, `Error saving user: ${err}`);
    return;
  })
});

bot.onText(/\/setAlert(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const threshold = match[1].trim();
  let current;

  utils.getRegistry().then(data => {
    const chatIdStr = String(chatId);
    // Check if user is registered
    if (data[chatIdStr]) {
      // check if user currently has an alert. 
      // If they do, remember their current to remove it later
      if (data[chatIdStr].alert) {
        current = data[chatIdStr].alert;
      }
      // Record the user's alert
      data[chatIdStr].alert = threshold;
      return utils.setRegistry(data);
    } else {
      throw new Error(`Please register with /register <your_name> <the_password>`);
    }
  }).then(() => {
    return utils.getAlerts();
  }).then(alerts => {
    // Add to alerts
    if (alerts[threshold] !== undefined) {
      // make sure no double alerts
      if (!alerts[threshold].includes(chatId)) {
        alerts[threshold].push(chatId);
      }
    } else {
      // Create new alert threshold
      alerts[threshold] = [chatId];
    }
    // Remove previous alert
    if (current) {
      alerts[current] = alerts[current].filter(x => x !== chatId);
      if (alerts[current].length === 0) {
        delete alerts[current];
      }
    }
    // Update alerts
    return utils.setAlerts(alerts);
  }).then(() => {
    bot.sendMessage(chatId, `Alert has been set for ${threshold} Gwei`);
    return;
  }).catch(err => {
    bot.sendMessage(chatId, `Error setting alert: ${err}`);
    return;
  })
})

bot.onText(/\/removeAlert/, (msg) => {
  const chatId = msg.chat.id;
  let threshold;

  utils.getRegistry().then(registry => {
    const chatIdStr = String(chatId);
    // Check if user is in the registry
    if (registry[chatIdStr]) {
      // Check if user even has an alert
      if (registry[chatIdStr].alert) {
        // Delete alert from user
        threshold = registry[chatIdStr].alert;
        delete registry[chatIdStr].alert;
        // Update registry
        return utils.setRegistry(registry);
      } else {
        // return
        throw new Error(`You do not have an alert with the GasPriceMonitorBot.`);
      }
    } else {
      throw new Error(`Please register with /register <your_name> <the_password> to use the GasPriceMonitorBot.`);
    }
  }).then(() => {
    // Get alerts
    return utils.getAlerts();
  }).then(alerts => {
    // Check if alert is in alerts
    if (alerts[threshold] !== undefined) {
      // Check if this is the only user with this alert
      if (alerts[threshold].length < 2) {
        delete alerts[threshold];
      } else {
        // Remove user from this alert
        alerts[threshold] = alerts.threshold.filter(x => x !== chatId);
      }
      // Update alerts
      return utils.setAlerts(alerts);
    } else {
      throw new Error(`Alert does not exist.`)
    }
  }).then(() => {
    // Success
    bot.sendMessage(chatId, `Alert has been removed.`);
    return;
  }).catch(err => {
    bot.sendMessage(chatId, `${err}`);
  })
})

bot.onText(/\/getGasPrice/, (msg) => {
  const chatId = msg.chat.id;

  web3.eth.getGasPrice().then(gasPriceInWei => {
    const inGwei = Math.ceil(parseInt(gasPriceInWei) / 1000000000);
    bot.sendMessage(chatId, `${inGwei} Gwei`);
    return;
  }).catch(err => {
    console.error(err);
    bot.sendMessage(chatId, `Error getting gas price: ${err}`);
    return;
  })
});

bot.on("polling_error", console.log);

/**
 * ADMIN COMMANDS
 */
bot.onText(/\/pollStart/, (msg) => {
  let interval;

  if (isAdmin(msg.chat.id)) {
    utils.getConfig().then(config => {
      interval = config.interval;
      return utils.buildCron(config.interval);
    }).then(cronStr => {
      console.log("CRON STR", cronStr);
      task = cron.schedule(cronStr, alertGasPrice);
      bot.sendMessage(process.env.ADMIN_CHAT, `Task started, running every ${interval}s`)
      return;
    }).catch(err => {
      bot.sendMessage(process.env.ADMIN_CHAT, `${err}`);
      return;
    })
  }
});

bot.onText(/\/setInterval(.+)/, (msg, match) => {
  if (isAdmin(msg.chat.id)) {
    const interval = parseInt(match[1].trim());

    utils.validateInterval(interval).then(() => {
      return utils.getConfig();
    }).then(config => {
      // Update config
      config.interval = interval;
      return utils.setConfig(config);
    }).then(() => {
      return utils.buildCron(interval);
    }).then(cronStr => {
      console.log("CRON STR", cronStr);
      if (task) {
        // destroy task
        task.stop();
        task = cron.schedule(cronStr, alertGasPrice);
        bot.sendMessage(process.env.ADMIN_CHAT, `Restarted task with interval ${interval}s`)
      } else {
        bot.sendMessage(process.env.ADMIN_CHAT, `Changed interval to ${interval}s`)
      }
    }).catch(err => {
      bot.sendMessage(process.env.ADMIN_CHAT, `${err}`);
    })
  }
});

bot.onText(/\/pollStop/, msg => {
  if (isAdmin(msg.chat.id)) {
    task.stop();
    bot.sendMessage(process.env.ADMIN_CHAT, `Task stopped`);
  }
})


/**
 * FUNCTIONS
 */
const isAdmin = (chatId) => chatId === parseInt(process.env.ADMIN_CHAT);

const getGasPrice = () => {
  return new Promise((resolve, reject) => {
    web3.eth.getGasPrice().then(gasPriceInWei => {
      const inGwei = Math.ceil(parseInt(gasPriceInWei) / 1000000000);
      resolve(inGwei);
    }).catch(reject);
  })
}

const alertGasPrice = () => {
  console.log("GETTING GAS PRICE")
  let gasPrice;
  getGasPrice().then(inGwei => {
    gasPrice = inGwei;
    console.log("GAS PRICE:", gasPrice);
    return utils.getAlerts();
  }).then(alerts => {
    Object.keys(alerts).map(threshold => {
      if (parseInt(threshold) > gasPrice) {
        alertUsers(alerts[threshold], gasPrice);
      }
    });
  }).catch(err => {
    bot.sendMessage(process.env.ADMIN_CHAT, `Error getting gas price: ${err}`);
  })
}

const alertUsers = (users, gasPrice) => {
  users.map(chatId => {
    bot.sendMessage(chatId, `Gas price is ${gasPrice} Gwei`);
  })
}