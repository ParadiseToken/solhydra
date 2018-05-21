# Solhydra

![License](https://img.shields.io/github/license/BlockChainCompany/solhydra.svg?style=flat-square)
[![Version](https://img.shields.io/npm/v/solhydra.svg?style=flat-square&label=version)](https://www.npmjs.org/package/solhydra)
![Node Version](https://img.shields.io/node/v/solhydra.svg?label=node%20version)

Solhydra is a cli tool to run solidity smart contract(s) through several analysis tools and generating a html report.

#### sample report of [cryptokitties-bounty](https://github.com/axiomzen/cryptokitties-bounty)

![sample report screenshot](https://github.com/BlockChainCompany/solhydra/raw/master/sample_report_screenshot.png)

## Description

There are a number of smart contract analysis tools which can give you valuable information about
your smart contracts. Just installing all these tools on your machine is quite the challenge.
If you manage to install all these tools next challenge will be finding out how to execute each of
these tools. After execution you are left with a number of files per tool, which you can then open
and inspect one-by-one. Wouldn't it be nice if there was a tool which takes care of installing (in Docker containers)
and executing all the analysis tools on a given directory with smart contracts + transforming the output
of each tool (per smart contract) into 1 HTML report which you can open in the browser so you can easily
inspect all output per tool, per smart contract. That's what this tool tries to accomplish 🎆.

Analysis tools included:
- [`mythril`](https://github.com/ConsenSys/mythril) [Docker image](https://hub.docker.com/r/rmi7/solhydra_mythril/)
- [`oyente`](https://github.com/melonproject/oyente) [Docker image](https://hub.docker.com/r/rmi7/solhydra_oyente/)
- [`solgraph`](https://github.com/raineorshine/solgraph) [Docker image](https://hub.docker.com/r/rmi7/solhydra_solgraph/)
- [`solhint`](https://github.com/protofire/solhint) [Docker image](https://hub.docker.com/r/rmi7/solhydra_solhint/)
- [`solidity-analyzer`](https://github.com/quantstamp/solidity-analyzer) [Docker image](https://hub.docker.com/r/rmi7/solhydra_solidity-analyzer/)
- [`solidity-coverage`](https://github.com/sc-forks/solidity-coverage) (only works on `truffle` projects) [Docker image](https://hub.docker.com/r/rmi7/solhydra_solidity-coverage/)
- [`solium`](https://github.com/duaraghav8/Solium) [Docker image](https://hub.docker.com/r/rmi7/solhydra_solium/)

## Prerequisites

- `docker` (tested on `17.12.0-ce`)

## Requirements

node version `>= 8.0.0`

## Install

`npm install -g solhydra`

## Usage

```
NAME
  solhydra        cli tool to run solidity smart contract(s) through several analysis
                  tools and generating a html report

SYNOPSIS
  solhydra --contract-dir=dirPath --dest-dir=dirPath [--dep-dir=dirPath] [tool1, tool2, ..]
  solhydra --truffle=dirPath --dest-dir=dirPath [tool1, tool2, ..]

TOOLS
  mythril, oyente, solhint, solidity-coverage, solidity-analyzer, solgraph, solium

REQUIRED ARGUMENTS
  --contract-dir  path of contracts directory (only when not specifying --truffle)
  --truffle       path of truffle project (only when not specifying --contract-dir)
  --dest-dir      path of the directory to write the result HTML report to,
                  will be named solhydra_report.html

OPTIONAL ARGUMENTS
  --dep-dir      path of directory with dependencies (node_modules),
                 only used with --contract-dir
  tool           you can optionally specify a subset of tools to run, if you don't
                 specify any tools, all tools will be executed

NOTES
  solidity-coverage only works on truffle projects, so only when using --truffle,
  it will be skipped automatically for non-truffle runs

EXAMPLES
  solhydra --contract-dir=./contracts --dep-dir=./node_modules --dest-dir=./out
  solhydra --contract-dir=./contracts --dep-dir=./node_modules --dest-dir=./out mythril oyente
  solhydra --truffle=./mytruffleproject --dest-dir=./out
  solhydra --truffle=./mytruffleproject --dest-dir=./out solidity-coverage solium
```

To display help (the above shown excerpt) type: `solhydra`.

## Notes

#### soljitsu flatten

The smart contracts are run through [`soljitsu flatten`](https://github.com/BlockChainCompany/soljitsu#feature-flatten),
since some analysis tools don't work with node_modules dependencies. So to keep reports consistent **all** tools are
executed on the `flatten` version of the smart contracts.

#### html report

- the generated HTML report has all it's **internal** js/css inlined, therefore it can be moved to any folder/machine and still work
- the generated HTML report fetches some external js/css from a cdn so an internet connection is required

## Todo

- [ ] `oyente` reports usage of an untested z3 + solc + evm, fix this
- [ ] add `slither` when it [becomes available](https://blog.trailofbits.com/2018/03/23/use-our-suite-of-ethereum-security-tools/)
- [ ] add `rattle` if/when it becomes available ([blogpost](https://blog.trailofbits.com/2018/03/23/use-our-suite-of-ethereum-security-tools/))
- [ ] enable [`maian`](https://github.com/MAIAN-tool/MAIAN) when [issue](https://github.com/MAIAN-tool/MAIAN/issues/10) is resolved
- [ ] enable [`echidna`](https://github.com/trailofbits/echidna) with a special option since it requires manually adding tests to solidity files
- [ ] add [`manticore`](https://github.com/trailofbits/manticore) as described [here](https://blog.trailofbits.com/2018/03/23/use-our-suite-of-ethereum-security-tools/)
- [ ] fix `highlightjs-solidity` highlighting, doesn't seem to work, it uses php highlighting?!

## License

MIT
