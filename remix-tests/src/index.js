const async = require('async')
const path = require('path')
const fs = require('fs')
require('colors')

let Compiler = require('./compiler.js')
let Deployer = require('./deployer.js')
let TestRunner = require('./testRunner.js')

const Web3 = require('web3')
const Provider = require('remix-simulator').Provider

var createWeb3Provider = function () {
  let web3 = new Web3()
  web3.setProvider(new Provider())
  return web3
}

var runTestSources = function (contractSources, testCallback, resultCallback, finalCallback, importFileCb, opts) {
  opts = opts || {}
  let web3 = opts.web3 || createWeb3Provider()
  let accounts = opts.accounts || null
  async.waterfall([
    function getAccountList (next) {
      if (accounts) return next()
      web3.eth.getAccounts((_err, _accounts) => {
        accounts = _accounts
        next()
      })
    },
    function compile (next) {
      Compiler.compileContractSources(contractSources, importFileCb, { accounts }, next)
    },
    function deployAllContracts (compilationResult, next) {
      Deployer.deployAll(compilationResult, web3, function (err, contracts) {
        if (err) {
          next(err)
        }

        next(null, compilationResult, contracts)
      })
    },
    function determineTestContractsToRun (compilationResult, contracts, next) {
      let contractsToTest = []
      let contractsToTestDetails = []

      for (let filename in compilationResult) {
        if (filename.indexOf('_test.sol') < 0) {
          continue
        }
        Object.keys(compilationResult[filename]).forEach(contractName => {
          contractsToTestDetails.push(compilationResult[filename][contractName])
          contractsToTest.push(contractName)
        })
      }

      next(null, contractsToTest, contractsToTestDetails, contracts)
    },
    function runTests (contractsToTest, contractsToTestDetails, contracts, next) {
      let totalPassing = 0
      let totalFailing = 0
      let totalTime = 0
      let errors = []

      var _testCallback = function (result) {
        if (result.type === 'testFailure') {
          errors.push(result)
        }
        testCallback(result)
      }

      var _resultsCallback = function (_err, result, cb) {
        resultCallback(_err, result, () => {})
        totalPassing += result.passingNum
        totalFailing += result.failureNum
        totalTime += result.timePassed
        cb()
      }

      async.eachOfLimit(contractsToTest, 1, (contractName, index, cb) => {
        TestRunner.runTest(contractName, contracts[contractName], contractsToTestDetails[index], { accounts }, _testCallback, (err, result) => {
          if (err) {
            return cb(err)
          }
          _resultsCallback(null, result, cb)
        })
      }, function (err, _results) {
        if (err) {
          return next(err)
        }

        let finalResults = {}

        finalResults.totalPassing = totalPassing || 0
        finalResults.totalFailing = totalFailing || 0
        finalResults.totalTime = totalTime || 0
        finalResults.errors = []

        errors.forEach((error, _index) => {
          finalResults.errors.push({context: error.context, value: error.value, message: error.errMsg})
        })

        next(null, finalResults)
      })
    }
  ], finalCallback)
}

var runTestFiles = function (filepath, isDirectory, web3, opts) {
  opts = opts || {}
  const { Signale } = require('signale')
  // signale configuration
  const options = {
    types: {
      result: {
        badge: '\t✓',
        label: '',
        color: 'greenBright'
      },
      name: {
        badge: '\n\t◼',
        label: '',
        color: 'white'
      },
      error: {
        badge: '\t✘',
        label: '',
        color: 'redBright'
      }
    }
  }
  const signale = new Signale(options)
  let accounts = opts.accounts || null
  async.waterfall([
    function getAccountList (next) {
      if (accounts) return next(null)
      web3.eth.getAccounts((_err, _accounts) => {
        accounts = _accounts
        next(null)
      })
    },
    function compile (next) {
      Compiler.compileFileOrFiles(filepath, isDirectory, { accounts }, next)
    },
    function deployAllContracts (compilationResult, next) {
      Deployer.deployAll(compilationResult, web3, function (err, contracts) {
        if (err) {
          next(err)
        }
        next(null, compilationResult, contracts)
      })
    },
    function determineTestContractsToRun (compilationResult, contracts, next) {
      let contractsToTest = []
      let contractsToTestDetails = []
      var gatherContractsFrom = (filename) => {
        if (filename.indexOf('_test.sol') < 0) {
          return
        }
        Object.keys(compilationResult[path.basename(filename)]).forEach(contractName => {
          contractsToTest.push(contractName)
          contractsToTestDetails.push(compilationResult[path.basename(filename)][contractName])
        })
      }

      if (isDirectory) {
        fs.readdirSync(filepath).forEach(filename => {
          gatherContractsFrom(filename)
        })
      } else {
        gatherContractsFrom(filepath)
      }
      next(null, contractsToTest, contractsToTestDetails, contracts)
    },
    function runTests (contractsToTest, contractsToTestDetails, contracts, next) {
      let totalPassing = 0
      let totalFailing = 0
      let totalTime = 0
      let errors = []

      var testCallback = function (result) {
        if (result.type === 'contract') {
          signale.name(result.value.white)
        } else if (result.type === 'testPass') {
          signale.result(result.value)
        } else if (result.type === 'testFailure') {
          signale.result(result.value.red)
          errors.push(result)
        }
      }
      var resultsCallback = function (_err, result, cb) {
        totalPassing += result.passingNum
        totalFailing += result.failureNum
        totalTime += result.timePassed
        cb()
      }

      async.eachOfLimit(contractsToTest, 1, (contractName, index, cb) => {
        TestRunner.runTest(contractName, contracts[contractName], contractsToTestDetails[index], { accounts }, testCallback, (err, result) => {
          if (err) {
            return cb(err)
          }
          resultsCallback(null, result, cb)
        })
      }, function (err, _results) {
        if (err) {
          return next(err)
        }

        console.log('\n')
        if (totalPassing > 0) {
          console.log(('  ' + totalPassing + ' passing ').green + ('(' + totalTime + 's)').grey)
        }
        if (totalFailing > 0) {
          console.log(('  ' + totalFailing + ' failing').red)
        }
        console.log('')

        errors.forEach((error, index) => {
          console.log('  ' + (index + 1) + ') ' + error.context + ' ' + error.value)
          console.log('')
          console.log(('\t error: ' + error.errMsg).red)
        })
        console.log('')

        next()
      })
    }
  ], function () {
  })
}

module.exports = {
  runTestFiles: runTestFiles,
  runTestSources: runTestSources,
  runTest: TestRunner.runTest,
  assertLibCode: require('../sol/tests.sol.js')
}
