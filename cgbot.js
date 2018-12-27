/*eslint-env es6, node*/

"use strict";

// *****************************
// Requires

const xmpp = require('simple-xmpp');
      config = require('./config.json'),
      fs = require('fs'),
      moment = require('moment'),
      _ = require('underscore'),
      Stanza = require('node-xmpp-client').Stanza,
      path = require('path'),
      spawn = require('cross-spawn');

// *****************************
// Globals

let cores = {};

// *****************************
// Main

config.groupchats = config.groupchats.map(groupchat => groupchat.toLowerCase());

xmpp.on('online', data => {
  const command = config.core.split(' ');
  config.groupchats.forEach(groupchat => {
    const core = spawn(command[0], _.rest(command));

    cores[groupchat] = core;

    core.stdout.on('data', data => {
      let stanza = new Stanza('message', {
        to: groupchat + '@' + config.conference,
        type: 'groupchat',
        id: config.nickname + performance.now()
      });

      stanza.c('body').t(data);

      xmpp.conn.send(stanza);
    });
  });

  fs.readdir(config.data, (error, files) => {
    Promise.all(files.map(file => {
      if (path.extname(file) !== '.log') {
        return;
      }

      const groupchat = file.split('-')[0].toLowerCase();

      return new Promise(resolve => {
        fs.readFile(config.data + '/' + file, { encoding: 'utf-8' }, (error, content) => {
          if (error) {
            console.error('Unable to read log file', file, error);
          }

          content.split('\n').forEach(line => {
            if (!line || line[0] !== '(' || line[9] !== ')') {
              return;
            }

            line = line.substring(11).replace(' : ', '');

            cores[groupchat].stdin.write(line + '\n');
          });

          console.log('Log file digest:', file);
        });
      });
    }))

    .then(() => {
      config.groupchats.forEach(groupchat => {
        cores[groupchat].stdin.write('### CLEAN');
        cores[groupchat].stdin.write('### ENABLE');
        xmpp.join(groupchat + '@' + config.muc + '/' + config.nickname);
      });
    });
  });
});

xmpp.on('error', error => {
  console.error('XMPP Error', error);
});

xmpp.on('groupchat', (conference, from, message, stamp, delay) => {
  if (from.toLowerCase() == config.nickname.toLowerCase()) {
    return;
  }

  message = message.replace(/[\n\r]/g, ' ');

  let now = moment();
  fs.appendFileSync(config.data + '/' + conference.toLowerCase() + '-' + now.format('YYYY-MM-DD') + '.log', '(' + now.format('HH:mm:ss') + ') ' + from + ' : ' + message + '\n');

  cores[conference.split('@')[0].toLowerCase()].stdin.write(message + '\n');
});

xmpp.connect({
  jid: config.jid,
  password: config.password,
  host: config.host,
  port: config.port
});