#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const gitClone = require('git-clone');
const yargs = require('yargs');
const untildify = require('untildify');
const copyDir = require('copy-dir');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const pug = require('pug');
const showdown = require('showdown');

const flatten = require('soljitsu/lib/flatten');
const combine = require('soljitsu/lib/combine');

const markdownConverter = new showdown.Converter();

const DOCKER_COMPOSE_PATH = path.join(__dirname, '..', 'docker-compose.yml');
// add timestamp to workspace dirname so we can run this file in parallel
const WORKSPACE_ID = Date.now().toString();
const WORKSPACE_DIR_PATH = path.join(__dirname, '..', '.workspaces', `workspace${WORKSPACE_ID}`);
const INPUT_DIR_PATH = path.join(WORKSPACE_DIR_PATH, 'input');
const OUTPUT_DIR_PATH = path.join(WORKSPACE_DIR_PATH, 'output');
const PUG_TEMPLATE_PATH = path.join(__dirname, 'report.pug');
const TMP_GIT_REPO_PATH = path.join(WORKSPACE_DIR_PATH, 'cloned-repo');

/** different tool outputs output different file types */
const toolOutputFileTypeMap = {
  mythril: 'markdown',
  oyente: 'text',
  surya_graph: 'image',
  surya_describe: 'text',
  surya_parse: 'text',
  surya_ftrace: 'text',
  surya_inheritance: 'image',
  solhint: 'text',
  'solidity-coverage': 'html',
  'solidity-analyzer': 'text',
  solium: 'text',
};

/** all currently enabled tools */
const AVAILABLE_TOOLS = [
  'mythril',
  'oyente',
  'solhint',
  'solidity-coverage',
  'solidity-analyzer',
  'surya',
  'solium',
];


// eslint-disable-next-line valid-jsdoc
/**
 * prints out help
 */
const printHelp = () => console.log(`NAME
  solhydra        cli tool to run solidity smart contract(s) through several analysis
                  tools and generating a html report

SYNOPSIS
  solhydra --contract-dir=dirPath --dest-file=dirPath [--npm-dir=dirPath --ethpm-dir=dirPath] [tool1, tool2, ..]
  solhydra --truffle=dirPath --dest-file=filePath [tool1, tool2, ..]
  solhydra --git=gitUrl --dest-file=filePath [tool1, tool2, ..]

TOOLS
  mythril, oyente, surya, solidity-coverage, solidity-analyzer, solhint, solium

REQUIRED ARGUMENTS
  --contract-dir  path of contracts directory (only when not specifying --truffle)
  --truffle       path of truffle project (only when not specifying --contract-dir)
  --dest-file     path of the file to write the result HTML report to

OPTIONAL ARGUMENTS
  --npm-dir       path of the directory with the NPM dependencies
                  only used with --contract-dir
  --ethpm-dir     path of the directory with the EthPM dependencies
                  only used with --contract-dir
  tool            you can optionally specify a subset of tools to run, if you don't
                  specify any tools, all tools will be executed

NOTES
  solidity-coverage only works on truffle projects, so only when using --truffle,
  it will be skipped automatically for non-truffle runs

EXAMPLES
  solhydra --contract-dir=./contracts --npm-dir=./node_modules --dest-file=./out
  solhydra --contract-dir=./contracts --ethpm-dir=./installed_contracts --dest-file=./out mythril oyente
  solhydra --truffle=./mytruffleproject --dest-file=./out
  solhydra --truffle=./mytruffleproject --dest-file=./out solidity-coverage solium
  solhydra --git=git@github.com:dapperlabs/cryptokitties-bounty.git --dest-file=./out surya mythril
`);

/**
 * given an input path return an absolute path
 *
 * @param {string} inputPath - the input path
 * @return {string} the input path converted to an absolute path
 */
const getAbsolutePath = (inputPath) => {
  inputPath = untildify(inputPath); // eslint-disable-line no-param-reassign
  // use path.resolve to remove the ending slash if it's a directory, needed
  // for comparing srcDir with destDir
  return path.resolve(path.isAbsolute(inputPath)
    ? inputPath
    : path.join(process.cwd(), inputPath));
};

/**
 * parses the cli args
 *
 * @return {object} object with parsed cli args (and paths converted to absolute)
 */
const parseArgs = () => { // eslint-disable-line consistent-return
  const { argv } = yargs;

  // contract dir is required
  /* eslint-disable no-mixed-operators */
  if ((!argv.contractDir && !argv.truffle && !argv.git)
       || (argv.contractDir && argv.truffle
           || argv.truffle && argv.git
           || argv.contractDir && argv.git)) { // eslint-disable-line no-mixed-operators, max-len
    console.log('\nmissing one(!) of: --contract-dir --truffle --git\n');
    printHelp();
    process.exit(1);
  }
  /* eslint-enable no-mixed-operators */

  // destination file is required
  if (!argv.destFile) {
    console.log('\nmissing required arg --dest-file\n');
    printHelp();
    process.exit(1);
  }

  // check for all tools we want to run
  if (argv._.length) {
    argv._.forEach((toolArg) => {
      if (!AVAILABLE_TOOLS.includes(toolArg)) {
        console.log(`\n'${toolArg}' is not a valid tool, valid tools are: ${AVAILABLE_TOOLS.join(', ')}\n`);
        printHelp();
        process.exit(1);
      }
    });
  }

  // git only works if it's a truffle project
  if (argv.truffle) {
    // solidity-coverage only works on a truffle project, if --truffle option
    return {
      // required
      destFilePath: getAbsolutePath(argv.destFile),
      contractPath: getAbsolutePath(path.join(argv.truffle, 'contracts')),

      // optional
      tools: argv._, // if no tools, all tools will be executed
      specPath: getAbsolutePath(path.join(argv.truffle, 'test')),
      npmDepPath: getAbsolutePath(path.join(argv.truffle, 'node_modules')),
      ethpmDepPath: getAbsolutePath(path.join(argv.truffle, 'installed_contracts')),
      migrationPath: getAbsolutePath(path.join(argv.truffle, 'migrations')),
      packageJsonPath: getAbsolutePath(path.join(argv.truffle, 'package.json')),
    };
  } else if (argv.git) {
    return {
      gitUrl: argv.git,

      // required
      destFilePath: getAbsolutePath(argv.destFile),
      contractPath: path.join(TMP_GIT_REPO_PATH, 'contracts'),

      // optional
      tools: argv._, // if no tools, all tools will be executed
      specPath: path.join(TMP_GIT_REPO_PATH, 'test'),
      npmDepPath: path.join(TMP_GIT_REPO_PATH, 'node_modules'),
      ethpmDepPath: path.join(TMP_GIT_REPO_PATH, 'installed_contracts'),
      migrationPath: path.join(TMP_GIT_REPO_PATH, 'migrations'),
      packageJsonPath: path.join(TMP_GIT_REPO_PATH, 'package.json'),
    };
  } else if (argv.contractDir) {
    return {
      // required
      destFilePath: getAbsolutePath(argv.destFile),
      contractPath: getAbsolutePath(argv.contractDir),

      // optional
      tools: argv._, // if no tools, all tools will be executed

      npmDepPath: argv.npmDir && getAbsolutePath(argv.npmDir),
      ethpmDepPath: argv.ethpmDir && getAbsolutePath(argv.ethpmDir),
    };
  }
};

/**
 * adds the contract directory found at contractPath to workspace/input/
 *
 * @param {string} contractPath - path where contracts are located in host
 */
const addOriginalContracts = (contractPath) => {
  const workspaceContractDir = path.join(INPUT_DIR_PATH, 'contracts');

  mkdirp.sync(workspaceContractDir);

  copyDir.sync(contractPath, workspaceContractDir);
};

/**
 * solhydra flatten contracts found at contractPath, writing the results to
 * workspace/input/contracts_flatten
 *
 * @param {string} contractPath - path where contracts are located in host
 * @param {string} npmDepPath - path where dependencies (node_modules) are located in host
 */
const addFlattenContracts = (contractPath, { npmDepPath, ethpmDepPath }) => {
  const workspaceContractFlattenPath = path.join(INPUT_DIR_PATH, 'contracts_flatten');

  mkdirp.sync(workspaceContractFlattenPath);

  flatten({
    srcDir: contractPath,
    destDir: workspaceContractFlattenPath,
    npmDir: npmDepPath, // might be undefined
    ethpmDir: ethpmDepPath, // might be undefined
  });
};

/**
 * solhydra combine contracts found at contractPath, writing the results to
 * workspace/input/contracts_combine
 *
 * @param {string} contractPath - path where contracts are located in host
 * @param {string} npmDepPath - path where dependencies (node_modules) are located in host
 */
const addCombineContracts = (contractPath, { npmDepPath, ethpmDepPath }) => {
  const workspaceContractCombinePath = path.join(INPUT_DIR_PATH, 'contracts_combine');

  mkdirp.sync(workspaceContractCombinePath);

  combine({
    srcDir: contractPath,
    destDir: workspaceContractCombinePath,
    npmDir: npmDepPath, // might be undefined
    ethpmDir: ethpmDepPath, // might be undefined
  });
};

/**
 * adds the package.json (and package-lock.json if it exists) found at packageJsonPath
 * to workspace/input/
 *
 * @param {string} packageJsonPath - path where package.json file is located in host
 */
const addPackageJson = (packageJsonPath) => {
  const packageJson = fs.readFileSync(packageJsonPath, 'utf8');

  // check for possible package-lock.json file
  try {
    fs.writeFileSync(
      path.join(INPUT_DIR_PATH, 'package-lock.json'),
      fs.readFileSync(packageJsonPath.replace('.js', '-lock.js'), 'utf8'), // <-- will error if doesnt exist
    );
  } catch (err) {
    // package-lock.json does not exist, do nothing
  }

  fs.writeFileSync(path.join(INPUT_DIR_PATH, 'package.json'), packageJson);
};

/**
 * adds the specs directory found at specPath to workspace/input/
 *
 * @param {string} specPath - path where specs are located in host
 */
const addSpecs = (specPath) => {
  const workspaceSpecPath = path.join(INPUT_DIR_PATH, 'specs');

  mkdirp.sync(workspaceSpecPath);

  copyDir.sync(specPath, workspaceSpecPath);
};

/**
 * adds the migration directory found at migrationPath to workspace/input/
 *
 * @param {string} migrationPath - path where migrations are located in host
 */
const addMigrations = (migrationPath) => {
  const workspaceMigrationPath = path.join(INPUT_DIR_PATH, 'migrations');

  mkdirp.sync(workspaceMigrationPath);

  copyDir.sync(migrationPath, workspaceMigrationPath);
};

/**
 * - copies the supplied files/directories into the workspace input directory
 * - creates flatten + combine versions of the contracts
 * - creates an info.json file
 *
 * @param {object} args - object with cli args
 */
const setupWorkspace = (args) => {
  mkdirp.sync(INPUT_DIR_PATH);
  addOriginalContracts(args.contractPath);
  addFlattenContracts(args.contractPath, { npmDepPath: args.npmDepPath, ethpmDepPath: args.ethpmDepPath }); // eslint-disable-line max-len
  addCombineContracts(args.contractPath, { npmDepPath: args.npmDepPath, ethpmDepPath: args.ethpmDepPath }); // eslint-disable-line max-len
  if (args.packageJsonPath) addPackageJson(args.packageJsonPath);
  if (args.specPath) addSpecs(args.specPath);
  if (args.migrationPath) addMigrations(args.migrationPath);
};

/**
 * execute all or a specific list of tools on the files in the workspace
 *
 * @param {string[]} [tools=[]] - possible list of tools to execute
 * @return {Promise.<Null, Error>} promise resolved on success or rejected with error
 */
const executeTasks = (tools = []) => new Promise((resolve, reject) => {
  try {
    const child = spawn(
      'docker-compose',
      // NOTE: when developing and testing new/updated docker images, add --build after 'up'
      ['-p', WORKSPACE_ID, '-f', DOCKER_COMPOSE_PATH, 'up', ...tools],
      { stdio: 'inherit', env: { ...process.env, WORKSPACE_ID } }, // to output stdout into this (parent) process
    );

    child.on('close', code => (
      code === 0 ? resolve() : reject(new Error(`exited with error code: ${code}`))
    ));
  } catch (err) {
    reject(err);
  }
});

/**
 * gathers the names of the contracts that were analyzed
 *
 * NOTE: use solhydra flatten files, since we than also get (nested) node_modules dependencies
 *
 * @return {string[]} list of contract names
 */
const getContractNames = () => (
  fs.readdirSync(path.join(INPUT_DIR_PATH, 'contracts_flatten'))
    .filter(filename => filename !== 'Migrations.sol')
);


/* eslint-disable no-nested-ternary, no-multi-spaces */
const getSubDirPathSplitted = filePath => (
  filePath.split('.').reduce((memo, item, idx, arr) => (
    // input:  Governance.Leader.LeaderGov.sol
    // output: [Goverance, Leader, LeaderGov.sol]
    idx === (arr.length - 1)
      ? memo                       // .sol
      : idx === (arr.length - 2)
        ? [...memo, `${item}.sol`] // filename <-- e.g. LeaderGov.sol
        : [...memo, item]          // (sub)dir <-- e.g. Governacne or Leader
  ), [])
);
/* eslint-enable no-nested-ternary, no-multi-spaces */

/**
 * creates list objects where each object contains info about 1 contract file
 *
 * @param {string[]} contractNames - list of contract names
 * @return {object[]} list of file info objects
 */
const generateFileOutputs = contractNames => (
  contractNames.reduce((memo, contractName) => ({
    ...memo,
    [contractName]: {
      slug: contractName.replace('.sol', '').replace(/\./g, '-').toLowerCase(),
      name: contractName,
      // node_module dependencies do not exist in the original contracts/ folder,
      // they come from node_modules/
      content: {
        flatten: fs.readFileSync(path.join(INPUT_DIR_PATH, 'contracts_flatten', contractName), 'utf8'),
        combine: fs.existsSync(path.join(INPUT_DIR_PATH, 'contracts_combine', contractName))
          ? fs.readFileSync(path.join(INPUT_DIR_PATH, 'contracts_combine', contractName), 'utf8')
          : undefined,
        original: fs.existsSync(path.join(INPUT_DIR_PATH, 'contracts', ...getSubDirPathSplitted(contractName)))
          ? fs.readFileSync(path.join(INPUT_DIR_PATH, 'contracts', ...getSubDirPathSplitted(contractName)), 'utf8')
          : undefined,
      },
    },
  }), {})
);

/**
 * gathers the names of each tool output
 *
 * @return {string[]} list of tool output names
 */
const getToolOutputNames = () => (
  fs.readdirSync(OUTPUT_DIR_PATH)
    // only if there are files in the tool output dir
    .filter(dirName => fs.readdirSync(path.join(OUTPUT_DIR_PATH, dirName)).length)
);

/**
 * creates object with per file per tool the output
 *
 * @param {string[]} contractNames - list of contract names
 * @param {string[]} toolOutputNames - list of tool output names
 * @return {object} object with per contract per tool the output
 */
const generateToolOutputs = (contractNames, toolOutputNames) => (
  contractNames
    .reduce((memo, contractName) => ({
      ...memo,
      [contractName]: toolOutputNames.reduce((memoToolOutput, toolOutputName) => (
        // surya uses "combined contracts", therefore there are no output files for
        // NPM/EthPM dependencies which would be ther eif we used "flattened contracts"
        !fs.existsSync(path.join(OUTPUT_DIR_PATH, toolOutputName, contractName))
          ? memoToolOutput
          : {
            ...memoToolOutput,
            [toolOutputName]: {
              type: toolOutputFileTypeMap[toolOutputName],
              content: toolOutputFileTypeMap[toolOutputName] === 'markdown'
                ? markdownConverter.makeHtml(fs.readFileSync(path.join(OUTPUT_DIR_PATH, toolOutputName, contractName), 'utf8'))
                : fs.readFileSync(path.join(OUTPUT_DIR_PATH, toolOutputName, contractName), 'utf8'),
            },
          }
      ), {}),
    }), {})
);

/**
 * creates the data object to pass to pug
 *
 * @param {object[]} fileOutputs - list of objects with info per file
 * @param {object[]} toolOutputs - list of objects with per file per tool the output
 * @return {object[]} object with 2 properties: fileOutputs, toolOutputs
 */
const generateRenderObject = (fileOutputs, toolOutputs) => ({
  fileOutputs,
  toolOutputs,
});

/**
 * generates HTML report from contents of workspace/output/
 *
 * @param {string} destFilePath - path of the destination folder to write the htmk report to
 */
const generateReport = (destFilePath) => {
  const toolOutputNames = getToolOutputNames();
  const contractNames = getContractNames();

  mkdirp.sync(path.dirname(destFilePath));

  fs.writeFileSync(
    destFilePath.endsWith('.html') ? destFilePath : `${destFilePath}.html`,
    pug.renderFile(
      PUG_TEMPLATE_PATH,
      generateRenderObject(
        generateFileOutputs(contractNames),
        generateToolOutputs(contractNames, toolOutputNames),
      ),
    ),
  );
};

/**
 * clones a given git repo into TMP_GIT_REPO_PATH + runs npm install in the repo folder
 *
 * @param {string} gitUrl - url of git repo to fetch, e.g. git@github.com:user/my-first-repo.git
 * @return {Promise.<Null, Error>} promise resolved or rejected
 */
const cloneRepo = gitUrl => (
  new Promise((resolve, reject) => {
    mkdirp.sync(TMP_GIT_REPO_PATH);
    console.log(`cloning git truffle repo: ${gitUrl}`);
    gitClone(gitUrl, TMP_GIT_REPO_PATH, { checkout: 'master' }, (err) => {
      if (err) reject(err);
      else {
        try {
          console.log('installing cloned project dependencies');
          const child = spawn(
            'npm',
            ['--prefix', TMP_GIT_REPO_PATH, 'install'],
            { stdio: 'inherit' }, // to output stdout into this (parent) process
          );
          child.on('close', code => (
            code === 0 ? resolve() : reject(new Error(`exited with error code: ${code}`))
          ));
        } catch (spawnErr) {
          reject(spawnErr);
        }
      }
    });
  })
);

/**
 * will start execution of code in this file
 */
const start = async () => {
  try {
    const args = parseArgs();
    args.gitUrl && await cloneRepo(args.gitUrl); // eslint-disable-line no-unused-expressions
    setupWorkspace(args);
    rimraf.sync(TMP_GIT_REPO_PATH);
    await executeTasks(args.tools);
    generateReport(args.destFilePath);
    rimraf.sync(WORKSPACE_DIR_PATH);
    process.exit(0);
  } catch (err) {
    console.log('\n\n\nERROR\n\n', err, '\n\n');
    rimraf.sync(WORKSPACE_DIR_PATH);
    process.exit(1);
  }
};

/**
 * catch Ctrl-C to do cleanup tasks
 */
process.on('SIGINT', () => {
  // remove workspace
  rimraf.sync(WORKSPACE_DIR_PATH);

  // make sure docker containers stopped
  execSync(
    `docker-compose -p ${WORKSPACE_ID} -f ${DOCKER_COMPOSE_PATH} stop`,
    { stdio: 'inherit', env: { ...process.env, WORKSPACE_ID } }, // to output stdout into this (parent) process
  );

  process.exit();
});

start();
