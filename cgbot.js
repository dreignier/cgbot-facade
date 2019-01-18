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
    queue = [],
    killed = false;

// *****************************
// Functions

let kill = () => {
  if (killed) {
    return;
  }

  killed = true;

  console.log('[INFO] Closing process');

  clearInterval(queueTimer);

  config.groupchats.forEach(groupchat => {
    if (cores.groupchat) {
      cores[groupchat].kill();
      cores[groupchat] = undefined;
    }
  });

  setTimeout(() => process.exit, 5000);
};

// *****************************
// Main

config.groupchats = config.groupchats.map(groupchat => groupchat.toLowerCase());

xmpp.on('online', data => {
  console.log('[INFO] Online:', data);

  const command = config.core.split(' ');
  config.groupchats.forEach(groupchat => {
    try {
      const core = spawn(command[0], _.rest(command), { stdio : ['pipe', 'pipe', 'pipe', 'ipc'] });

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
        data = data.toString('utf8').split('\n');

        for (let line of data) {
          line = line.replace(/[\n\r]/g, '');
          console.error('[ERROR]', groupchat + ':', line);
        }
      });

      core.on('close', () => {
        console.error('[ERROR]', groupchat + ': Core is dead');
        process.exit(1);
      });
    } catch (e) {
      console.error("[ERROR] Can't spawn", groupchat + ':', e);
      process.exit(1);
    }
  });

  fs.readdir(config.data, (error, files) => {
    if (error) {
      console.error('[ERROR] Unable to read dir', config.data);
      process.exit(1);
    }

    try {
      Promise.all(config.groupchats.map(groupchat => {
          return files.reduce((promise, file) => {
            try {
              if (path.extname(file) !== '.log') {
                return promise;
              }

              const fileGroupchat = file.split('@')[0].toLowerCase();

              if (fileGroupchat !== groupchat) {
                return promise;
              }

              return promise.then(() => {
                return new Promise((resolve, reject) => {

                  try {
                    let stream = fs.createReadStream(config.data + '/' + file, { encoding: 'utf-8' });

                    stream.on('end', () => {
                      stream.close();
                      resolve();
                    });

                    stream.pipe(cores[groupchat].stdin, {
                      end: false
                    });
                  } catch (e) {
                    reject(e);
                  }
                });
              });
            } catch (e) {
              console.error('[ERROR] Unable to log file', file + ':', e);
            }
          }, Promise.resolve());
      }))

      .then(() => {
        config.groupchats.forEach(groupchat => {
          cores[groupchat].stdin.write('### ENABLE\n');
          xmpp.join(groupchat + '@' + config.muc + '/' + config.nickname);
        });
      })

      .catch(error => {
        console.error('[ERROR] Unable to read logs files: ', error);
        process.exit(1);
      });
    } catch (error) {
      console.error('[ERROR] Unable to read logs files: ', error);
      process.exit(1);
    }
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
