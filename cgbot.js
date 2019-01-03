/*eslint-env es6, node*/

"use strict";

// *****************************
// Requires

const xmpp = require('simple-xmpp'),
      config = require('./config.json'),
      fs = require('fs'),
      moment = require('moment'),
      _ = require('underscore'),
      Stanza = require('node-xmpp-client').Stanza,
      path = require('path'),
      spawn = require('cross-spawn');

// *****************************
// Globals

let cores = {},
    queueTimer,
    queue = [];

// *****************************
// Functions

let kill = () => {
  console.log('[INFO] Closing process');

  clearInterval(queueTimer);

  config.groupchats.forEach(groupchat => {
    if (cores.groupchat) {
      cores[groupchat].kill();
      cores[groupchat] = undefined;
    }
  });
  process.exit();
};

// *****************************
// Main

config.groupchats = config.groupchats.map(groupchat => groupchat.toLowerCase());

xmpp.on('online', data => {
  console.log('[INFO] Online');

  const command = config.core.split(' ');
  config.groupchats.forEach(groupchat => {
    const core = spawn(command[0], _.rest(command));

    cores[groupchat] = core;

    core.stdout.on('data', data => {
      data = data.toString('utf8').split('\n');

      for (let line of data) {
        line = line.replace(/[\n\r]/g, '');

        if (line) {
          console.log('[INFO]', groupchat + ':', line);

          if (!line.startsWith('###')) {
            try {
              let stanza = new Stanza('message', {
                to: groupchat + '@' + config.muc,
                type: 'groupchat',
                id: config.nickname + new Date().getTime()
              });

              stanza.c('body').t(line);

              queue.push(stanza);
            } catch (e) {
              console.error('[ERROR]', e);
            }
          } else {
            line = line.substring(4);

            // Future feature
          }
        }
      }
    });

    core.stderr.on('data', data => {
      console.error('[ERROR] ' + groupchat + ':', data.toString('utf8').replace(/[\n\r]/g, ''));
    });

    core.on('close', () => {
      console.error('[ERROR] ' + groupchat + ': Core is dead');
      process.exit();
    });
  });

  fs.readdir(config.data, (error, files) => {
    if (error) {
      console.error('[ERROR] Unable to read dir', config.data);
      process.exit(1);
    }

    Promise.all(files.map(file => {
      if (path.extname(file) !== '.log') {
        return;
      }

      const groupchat = file.split('@')[0].toLowerCase();

      return new Promise(resolve => {
        fs.readFile(config.data + '/' + file, { encoding: 'utf-8' }, (error, content) => {
          if (error) {
            console.error('[ERROR] Unable to read log file', file, error);
            resolve();
            return;
          }

          content.split('\n').forEach(line => {
            if (!line || line[0] !== '(' || line[9] !== ')') {
              return;
            }

            line = line.substring(11).replace(' : ', '');

            cores[groupchat].stdin.write(line + '\n');
          });

          resolve();
        });
      });
    }))

    .then(() => {
      config.groupchats.forEach(groupchat => {
        cores[groupchat].stdin.write('### ENABLE\n');
        xmpp.join(groupchat + '@' + config.muc + '/' + config.nickname);
      });
    });
  });
});

xmpp.on('groupchat', (conference, from, message, stamp, delay) => {
  if (from.toLowerCase() == config.nickname.toLowerCase()) {
    return;
  }

  message = message.replace(/[\n\r]/g, ' ');

  let now = moment();
  fs.appendFileSync(config.data + '/' + conference.toLowerCase() + '-' + now.format('YYYY-MM-DD') + '.log', '(' + now.format('HH:mm:ss') + ') ' + from + ' : ' + message + '\n');

  cores[conference.split('@')[0].toLowerCase()].stdin.write(from + ' ' + message + '\n');
});

xmpp.on('error', error => {
  console.error('[ERROR] XMPP Error', error);
});

xmpp.on('close', data => {
  console.error('[ERROR] Connection closed:', data);
  process.exit(1);
});

console.log('[INFO] Connecting to', config.host + ':' + config.port);

xmpp.connect({
  jid: config.jid,
  password: config.password,
  host: config.host,
  port: config.port
});

queueTimer = setInterval(function() {
  if (queue.length) {
      xmpp.conn.send(queue[0]);
      queue.shift();
  }
}, 5000);

process.on('exit', kill);
process.on('SIGINT', kill);
process.on('SIGUSR1', kill);
process.on('SIGUSR2', kill);
process.on('uncaughtException', kill);