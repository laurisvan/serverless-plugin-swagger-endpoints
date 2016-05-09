'use strict';

/**
 * Serverless Swagger Endpoints
 * - A drop-in replacement for endpoint configuration by Swagger templates
 * - User AWS importer to deploy the Swagger documented endpoints
 * - Binds into Serverless function definitions
 */

const path      = require('path'),
  BbPromise     = require('bluebird'),
  fs            = BbPromise.promisifyAll(require('fs')),
  swaggerParser = require('swagger-parser'),
  jsonPath      = require('jsonpath');

module.exports = function(S) { // Always pass in the ServerlessPlugin Class

  const SUtils = S.utils;
  const SError = require(S.getServerlessPath('Error'));
  const SCli = require(S.getServerlessPath('utils/cli'));

  S.classes.Project.newStaticMethod     = function() { console.log("A new method!"); };
  S.classes.Project.prototype.newMethod = function() { S.classes.Project.newStaticMethod(); };

  /**
   * Extending the Plugin Class
   * - Here is how you can add custom Actions and Hooks to Serverless.
   * - This class is only required if you want to add Actions and Hooks.
   */
  class SwaggerEndpoints extends S.classes.Plugin {

    /**
     * Constructor
     * - Keep this and don't touch it unless you know what you're doing.
     */

    constructor() {
      super();
      this.name = 'serverless-plugin-swagger-endpoints';
    }

    /**
     * Register Actions
     * - If you would like to register a Custom Action or overwrite a Core Serverless Action, add this function.
     * - If you would like your Action to be used programatically, include a "handler" which can be called in code.
     * - If you would like your Action to be used via the CLI, include a "description", "context", "action" and any options you would like to offer.
     * - Your custom Action can be called programatically and via CLI, as in the example provided below
     */
    registerActions() {

      S.addAction(this._swaggerDeploy.bind(this), {
        handler:       'swaggerDeploy',
        description:   'A custom action from a custom plugin',
        context:       'swagger',
        contextAction: 'deploy',
        options:       [
          {
            option:      'stage',
            shortcut:    's',
            description: 'Optional if only one stage is defined in project'
          }, {
            option:      'region',
            shortcut:    'r',
            description: 'Optional - Target one region to deploy to'
          }, {
            option:      'all',
            shortcut:    'a',
            description: 'Optional - Deploy all Functions'
          }, {
            option:      'swaggerPath',
            shortcut:    'w',
            description: 'Swagger file path (relative to project root)'
          }, {
            option:      'mode',
            shortcut:    'm',
            description: 'Import Mode (\'merge\' or \'overwrite\')'
          }
        ],
        parameters: [
          {
            parameter: 'names',
            description: 'The names/ids of the endpoints you want to deploy in this format: user/create~GET',
            position: '0->'
          }
        ]
      });

      return BbPromise.resolve();
    }

    /**
     * Register Hooks
     * - If you would like to register hooks (i.e., functions) that fire before or after a core Serverless Action or your Custom Action, include this function.
     * - Make sure to identify the Action you want to add a hook for and put either "pre" or "post" to describe when it should happen.
     */

    registerHooks() {

      S.addHook(this._hookPre.bind(this), {
        action: 'functionRun',
        event:  'pre'
      });

      S.addHook(this._hookPost.bind(this), {
        action: 'functionRun',
        event:  'post'
      });

      return BbPromise.resolve();
    }

    /**
     * Swagger Deploy
     */
    _swaggerDeploy(evt) {
      this.evt = evt;

      // Flow
      return this._loadSwaggerDefinition()
          .bind(this)
          .then(() => {
              // Prompt: Stage
            if (!S.config.interactive || this.evt.options.stage) return;

            return this.cliPromptSelectStage('Swagger Deployer - Choose a stage: ', this.evt.options.stage, false)
              .then(stage => this.evt.options.stage = stage)
          })
          .then(this._validateAndPrepare)
          .then(this._pruneInvalidElements)
          .then(this._applyFilters)
          .then(this._processDeployment)
          .then(function() {
            console.log(this.evt);
            
            return this.evt;
          });
    }

    _loadSwaggerDefinition() {
      let projectPath = SUtils.findProjectPath(process.cwd());
      let swaggerPath = this.evt.options.swaggerPath || 'swagger.yaml';

      this.swaggerPath = path.resolve(projectPath, swaggerPath);
      
      // Parse the Swagger path
      return new BbPromise.try(() => {
          return swaggerParser.parse(this.swaggerPath);
        })
        .bind(this)
        .then((api) => {
          SUtils.sDebug('Loaded Swagger definitions from ' + this.swaggerPath);

          this.swaggerApi = api;
          return api;
        });
    }

    /**
     * Prune options that API gateway does not suppport
     */
    _pruneInvalidElements() {
      let api = this.swaggerApi;

      // Serverless expects API gateway to be named after the project name
      let titles = jsonPath.query(api, '$.info.title');
      let restApiName = this.restApiName;
      if ((titles.length > 0) && (restApiName !== titles[0])) {
        console.log('Swagger API title', titles[0],
          'does not match Serverless project name', restApiName);
        console.log('Forcing', restApiName, 'to prevent problems later');
        api.info.title = restApiName;
      }

      // Prune responses.default
      let responses = jsonPath.query(api, '$.paths..responses');
      responses.forEach((response) => {
        if (response.default) {
          console.log('Prune \'responses.default\' - not supported by API Gateway.');
          delete response.default;
        }
      });

      // Prune object.additionalProperties
      let objects = jsonPath.query(api, '$..[?(@.type=="object")]');
      objects.forEach((object) => {
        if (object.additionalProperties) {
          console.log('Prune \'object.additionalProperties\' - not supported by API Gateway.');
          delete object.additionalProperties;
        }
      });

      return api;
    }

    _applyFilters() {
      let api = this.swaggerApi;

      // Construct the base objcet
      let filtered = {
        swagger: api.swagger,
        info: {
          title: api.info.title
        }
      }

      // Apply the filtered objects
      filtered.paths = {
        '/foobar': api.paths['/bookings']
      };

      // Apply the references of the filtered path
      /*let definitions = {};
      let unresolved = jsonPath.query(filtered, '$..[?(@["$ref"])]');
      let refs = swaggerParser.resolve(api);

      unresolved.forEach((ref) => {
        let key = ref['$ref'].substring('#/definitions/'.length);
        let value = api.definitions[key];
        definitions[key] = value;
      });
      filtered.definitions = definitions;*/
      // FIXME Models have so many interdependencies, that just apply all
      filtered.definitions = api.definitions;
 
      this.swaggerApi = filtered;
      console.log(JSON.stringify(this.swaggerApi, null, 2));

      return BbPromise.resolve(this.swaggerApi);
    }

    /**
     * Validate And Prepare
     * - If CLI, maps CLI input to event object
     */
    _validateAndPrepare() {
      let names = this.evt.options.names || [];
      let endpoints = [];
      let project = S.getProject();
      let stage = this.evt.options.stage;
      let region = project.getRegion(stage, this.evt.options.region);
      let variables = region.getVariables();
      let restApi = variables['apiGatewayApi'] || project.name;

      // Set defaults
      this.evt.options.names = names;
      let mode = this.evt.options.mode || 'merge';
      if (mode !== 'merge' && mode !== 'overwrite') {
        return BbPromise.reject(new Error('Unknown mode \'' + mode + '\''));
      }
      this.evt.options.mode = this.evt.options.mode || 'merge';

      this.project = project;
      this.provider = S.getProvider();
      this.restApiName = restApi;

      /*// Prepare endpoints
      if (this.evt.options.all) {
        endpoints = project.getAllEndpoints();
      }
      else if (names.length) {
        endpoints = project.getEndpointsByNames(names);
      }
      else if (S.cli) {
        let functionsByCwd = SUtils.getFunctionsByCwd(project.getAllFunctions());
        functionsByCwd.forEach((func) => {
          func.getAllEndpoints().forEach((endpoint) => endpoints.push(endpoint));
        });
      }

      if (endpoints.length === 0) {
        throw new SError('You don\'t have any endpoints in your project');
      }

      // Reduce collected endpoints to endpoint names
      this.endpoints = this.endpoints.map((e) => e.getName());

      // Validate Stage
      if (!this.evt.options.stage) {
        throw new SError('Stage is required');
      }*/

      return BbPromise.resolve();
    }

    /**
     * Process Endpoint Deployment
     */

    _processDeployment() {

      let stage = this.evt.options.stage;
      let region = this.evt.options.region;
      let restApiName = this.restApiName;
      let swaggerApi = this.swaggerApi;
      let mode = this.evt.options.mode;

      // Find the API
      return this.provider.getApiByName(restApiName, stage, region)
        .then((apiDefinition) => {
          let params;
          let command;

          // API Already exists
          if (apiDefinition) {
            params = {
              body: JSON.stringify(swaggerApi, null, 2),
              restApiId: apiDefinition.id,
              failOnWarnings: true,
              mode: mode
            };
            command = 'putRestApi';
          }
          else {
            // New API
            params = {
              body: JSON.stringify(swaggerApi, null, 2),
              failOnWarnings: true
            };
            command = 'importRestApi';
          }

          return this.provider.request('APIGateway', command, params, stage, region);
        })
        .then(function (response) {
          SUtils.sDebug(
            '"'
            + stage
            + ' - '
            + region
            + '": created a new REST API: '
            + response);

          return response;
        })
        .bind(this)
        .then(function(evt) {
          //console.log(JSON.stringify(evt, null, 2));
          //this.evt.data.deployed = evt.data.deployed;
          //this.evt.data.failed   = evt.data.failed;
        });
    }

    /**
     * Your Custom PRE Hook
     * - Here is an example of a Custom PRE Hook.  Include this and modify it if you would like to write your a hook that fires BEFORE an Action.
     * - Be sure to ALWAYS accept and return the "evt" object, or you will break the entire flow.
     * - The "evt" object contains Action-specific data.  You can add custom data to it, but if you change any data it will affect subsequent Actions and Hooks.
     * - You can also access other Project-specific data @ this.S Again, if you mess with data on this object, it could break everything, so make sure you know what you're doing ;)
     */

    _hookPre(evt) {

      let _this = this;

      return new BbPromise(function (resolve, reject) {

        console.log('-------------------');
        console.log('YOUR SERVERLESS PLUGIN\'S CUSTOM "PRE" HOOK HAS RUN BEFORE "FunctionRun"');
        console.log('-------------------');

        return resolve(evt);

      });
    }

    /**
     * Your Custom POST Hook
     * - Here is an example of a Custom POST Hook.  Include this and modify it if you would like to write your a hook that fires AFTER an Action.
     * - Be sure to ALWAYS accept and return the "evt" object, or you will break the entire flow.
     * - The "evt" object contains Action-specific data.  You can add custom data to it, but if you change any data it will affect subsequent Actions and Hooks.
     * - You can also access other Project-specific data @ this.S Again, if you mess with data on this object, it could break everything, so make sure you know what you're doing ;)
     */

    _hookPost(evt) {

      let _this = this;

      return new BbPromise(function (resolve, reject) {

        console.log('-------------------');
        console.log('YOUR SERVERLESS PLUGIN\'S CUSTOM "POST" HOOK HAS RUN AFTER "FunctionRun"');
        console.log('-------------------');

        return resolve(evt);

      });
    }
  }

  // Export Plugin Class
  return SwaggerEndpoints;

};