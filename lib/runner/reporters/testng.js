/**
 * @type {exports}
 */
const fs = require('fs');
const mkpath = require('mkpath');
const path = require('path');
const ejs = require('ejs');
const Utils = require('../../util/utils.js');
const runner = require('child_process');
const minimist = require('minimist');

let args = minimist(process.argv.slice(2), {
  alias: {
      h: 'help',
      v: 'version',
      u: 'url',
      gat: 'googleAnalyticsTag',
      t: 'title'
  }
});

console.log("args:", args);

let home = args.url;
if(!home.includes('https://')){
  home = 'https://'+home+'/';
}

let __tmplData__ = '';

class testNGReporter {
  constructor(results, opts = {}) {
    this.results = results;
    this.options = opts;
    //console.log('report results: ');
    //console.log(results);
    //console.log('report options: ');
    //console.log(opts);
  }

  static get templateFile() {
    return path.join(__dirname, 'testng.xml.ejs');
  }

  static set tmplData(val) {
    __tmplData__ = val;
  }

  static get tmplData() {
    return __tmplData__;
  }

  static loadTemplate() {
    return new Promise((resolve, reject) => {
      if (testNGReporter.tmplData) {
        return resolve(testNGReporter.tmplData);
      }

      fs.readFile(testNGReporter.templateFile, (err, data) => {
        if (err) {
          return reject(err);
        }

        testNGReporter.tmplData = data.toString();
        resolve(testNGReporter.tmplData);
      });
    });
  }

  static createReportFolder(output_folder) {
    return new Promise((resolve, reject) => {
      mkpath(output_folder, function (err) {
        if (err) {
          return reject(err);
        }

        resolve();
      });
    });
  }

  adaptAssertions(module) {
    Object.keys(module.completed).forEach(function(item) {
      let testcase = module.completed[item];
      let assertions = testcase.assertions;

      for (let i = 0; i < assertions.length; i++) {
        if (assertions[i].stackTrace) {
          assertions[i].stackTrace = Utils.stackTraceFilter(assertions[i].stackTrace.split('\n'));
        }
      }

      if (testcase.failed > 0 && testcase.stackTrace) {
        let stackParts = testcase.stackTrace.split('\n');
        let errorMessage = stackParts.shift();
        testcase.stackTrace = Utils.stackTraceFilter(stackParts);
        testcase.message = errorMessage;
      }
    });
  }

  writeReportFile(filename, rendered, shouldCreateFolder, output_folder) {
    return (shouldCreateFolder ?
        testNGReporter.createReportFolder(output_folder) :
      Promise.resolve()
    ).then(() => {
      return new Promise((resolve, reject) => {
        fs.writeFile(filename, rendered, function(err) {
          if (err) {
            return reject(err);
          }

          resolve();
        });
      });
    });
  }

  writeReport(moduleKey, data) {
    let module = this.results.modules[moduleKey];
    let pathParts = moduleKey.split(path.sep);
    let moduleName = pathParts.pop();
    let className = moduleName;
    let output_folder = this.options.output_folder;
    let shouldCreateFolder = false;

    this.adaptAssertions(module);

    if (pathParts.length) {
      output_folder = path.join(output_folder, pathParts.join(path.sep));
      className = pathParts.join('.') + '.' + moduleName;
      shouldCreateFolder = true;
    }

    let filename = path.join(output_folder, `${module.reportPrefix}${moduleName}.xml`);
    let rendered = ejs.render(data, {
      module: module,
      moduleName: moduleName,
      className: className,
      systemerr: this.results.errmessages.join('\n')
    });

    rendered = Utils.stripControlChars(rendered);

    return this.writeReportFile(filename, rendered, shouldCreateFolder, output_folder)
      .then(_ => {
        console.log('Wrote report file to: ' + filename +'.');

        var conversionScriptPath = path.join(__dirname + '../../../../../../conversion_script.php');
        console.log('Calling PHP Conversion Script: ' + conversionScriptPath +'.');

        runner.exec('php "' + conversionScriptPath + '" ' + filename, function(err, phpResponse, stderr) {
          if(err) console.log(err); //log error?
          console.log( phpResponse );
        });

        var unicornScriptPath = path.join(__dirname + '../../../../../../w3unicorn.php');
        console.log('Calling W3 Unicorn PHP Test')

        runner.exec('php "' + unicornScriptPath + '" ' + home, function(err, phpResponse, stderr) {
          if(err) console.log(err); //log error?
          console.log( phpResponse );
        });

        var waveScriptPath = path.join(__dirname + '../../../../../../wave-accessibility.php');
        console.log('Compiling WAVE Accessibility Test');
        //console.log('php "' + waveScriptPath + '" ' + home);

        runner.exec('php "' + waveScriptPath + '" ' + home, function(err, phpResponse, stderr) {
          if(err) console.log(err); //log error?
          console.log( phpResponse );
        });

        var whoisScriptPath = path.join(__dirname + '../../../../../../whois-report.php');
        console.log('Compiling Who.is Report');
        //console.log('php "' + waveScriptPath + '" ' + home);

        runner.exec('php "' + whoisScriptPath + '" ' + home, function(err, phpResponse, stderr) {
          if(err) console.log(err); //log error?
          console.log( phpResponse );
        });

      });
  }

  write() {
    let keys = Object.keys(this.results.modules);

    return testNGReporter.loadTemplate()
      .then(data => {
        let promises = keys.map(moduleKey => {
          return this.writeReport(moduleKey, data);
        });

        return Promise.all(promises);
      });
  }
}


module.exports = (function() {
    console.log('Compiling custom report file');

    return {
      write(results, options, callback) {
/*
        console.log('results passed to write function:');
        console.log(JSON.stringify(results));
        console.log('options passed to write function:');
        console.log(JSON.stringify(options));
*/
        let reporter = new testNGReporter(results, options);
        console.log('Writing custom report file');
        reporter.write()
          .then(_ => {
            callback();
          })
          .catch(err => {
            console.log(err);
  
            callback(err);
          });
      }
    };
  })();