var async = require('async');
var bufferEq = require('buffer-equal-constant-time');
var bodyParser = require('body-parser');
var childProcess = require('child_process');
var express = require('express');
var fs = require('fs');

var config = require('./config');

var app = express();

var GITHUB_TOKEN = process.env.GITHUB_TOKEN;
var REPO = config.repo;
var WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Git config.
childProcess.execSync('git config --global user.email aframebot@gmail.com');
childProcess.execSync('git config --global user.name A-frobot');

// Clone repository.
new Promise((resolve, reject) => {
  if (fs.existsSync('aframe')) { return resolve(); }

  childProcess.spawn('git', ['clone', `https://${GITHUB_TOKEN}@github.com/${REPO}.git`], {
    stdio: 'inherit'
  }).on('close', resolve);
}).then(initApp);

/**
 * Express app.
 */
function initApp () {
  app.set('port', (process.env.PORT || 5000));
  app.use(bodyParser.json());
  app.get('/', function (req, res) {
    res.send('AFRO');
  })

  // Webhook handler.
  app.post('/postreceive', function handler (req, res) {
    let data = req.body;

    // Validate payload.
    let computedSig = new Buffer(
      `sha1=${crypto.createHmac('sha1', SECRET_TOKEN).update(data).digest('hex')}`
    );
    let githubSig = new Buffer(req.headers['x-hub-signature']);
    if (!bufferEq(computedSig, githubSig)) {
      console.log('Received invalid GitHub webhook signature. Check SECRET_TOKEN.');
      return;
    }

    console.log(`Received commit ${data.after} for ${data.repository.full_name}.`);

    if (data.repository.full_name === REPO) {
      bumpAframeDist(data);
    }

    res.send(data);
  })

  // Express listen.
  app.listen(app.get('port'), function () {
    console.log('Node app is running on port', app.get('port'));
  })
}

/**
 * Bump A-Frame master build on every commit.
 */
function bumpAframeDist (data) {
  if (!hasAframeCodeChanges(data)) { return Promise.resolve(false); }

  return new Promise(resolve => {
    console.log(`Bumping ${REPO} dist...`);
    async.series([
      execAframeCommand('git pull --rebase origin master'),
      execAframeCommand('node --max-old-space-size=200 /app/.heroku/node/bin/npm install'),
      execAframeCommand('node --max-old-space-size=200 /app/.heroku/node/bin/npm install --only="dev"'),
      execAframeCommand('npm run dist'),
      execAframeCommand('git add dist'),
      execAframeCommand('git commit -m "bump dist"'),
      execAframeCommand(`git push https://${GITHUB_TOKEN}@github.com/${REPO}.git master`)
    ], function asyncSeriesDone (err) {
      if (err) { return console.error(err); }
      console.log(`${REPO} dist successfully bumped!`);
      resolve(true);
    });
  });
}
module.exports.bumpAframeDist = bumpAframeDist;

/**
 * Helper for async.js.
 */
function execAframeCommand (command) {
  return callback => {
    console.log(`Running ${command}...`);
    childProcess.exec(command, {cwd: 'aframe', stdio: 'inherit'}, (err, stdout)  => {
      if (err) { console.error(err); }
      callback();
    });
  };
}
module.exports.execAframeCommand = execAframeCommand;

/**
 * Check if A-Frame commit has actual code changes.
 */
function hasAframeCodeChanges (data) {
  return data.head_commit.modified.filter(function (file) {
    return file.indexOf('src/') === 0 || file.indexOf('vendor/') === 0 ||
           file === 'package.json';
  }).length !== 0;
}
module.exports.hasAframeCodeChanges = hasAframeCodeChanges;
