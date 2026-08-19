import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#/common/helpers/convict/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'grants-reporting-processor'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: ['local', 'infra-dev', 'management', 'dev', 'test', 'perf-test', 'ext-test', 'prod'],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : ['req', 'res', 'responseTime']
    }
  },
  mongo: {
    mongoUrl: {
      doc: 'URI for mongodb',
      format: String,
      default: 'mongodb://127.0.0.1:27017/',
      env: 'MONGO_URI'
    },
    databaseName: {
      doc: 'database for mongodb',
      format: String,
      default: 'grants-reporting-processor',
      env: 'MONGO_DATABASE'
    },
    mongoOptions: {
      retryWrites: {
        doc: 'Enable Mongo write retries, overrides mongo URI when set.',
        format: Boolean,
        default: null,
        nullable: true,
        env: 'MONGO_RETRY_WRITES'
      },
      readPreference: {
        doc: 'Mongo read preference, overrides mongo URI when set.',
        format: ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'],
        default: null,
        nullable: true,
        env: 'MONGO_READ_PREFERENCE'
      }
    }
  },
  aws: {
    endpointUrl: {
      doc: 'AWS Endpoint URL used for LocalStack',
      format: String,
      nullable: true,
      default: null,
      env: 'AWS_ENDPOINT_URL'
    },
    region: {
      doc: 'AWS Region',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    },
    s3: {
      forcePathStyle: {
        doc: 'Force path style on S3 bucket',
        format: Boolean,
        default: true,
        env: 'FORCE_PATH_STYLE'
      },
      rawBucketName: {
        doc: 'Raw events S3 bucket name',
        format: String,
        default: 'raw-event-bucket',
        env: 'RAW_EVENT_BUCKET_NAME'
      },
      outputBucketName: {
        doc: 'Processed events (output) S3 bucket name',
        format: String,
        default: 'processed-event-bucket',
        env: 'PROCESSED_EVENT_BUCKET_NAME'
      }
    },
    sqs: {
      featuresQueueUrl: {
        doc: 'URL of the SQS queue to receive new features updates from',
        format: String,
        default: '#',
        env: 'FEATURES_QUEUE_URL'
      }
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  jobs: {
    processReportingData: {
      schedule: {
        doc: 'Cron schedule for the process reporting data job',
        format: String,
        default: '0 * * * 1-5',
        env: 'PROCESS_REPORTING_DATA_SCHEDULE'
      }
    }
  },
  microsoft: {
    azure: {
      tenantId: {
        doc: 'Azure Tenant ID',
        format: String,
        default: '6f504113-6b64-43f2-ade9-242e05780007',
        nullable: false,
        env: 'AZURE_TENANT_ID'
      },
      clientId: {
        doc: 'Azure Client ID',
        format: String,
        default: '2eb3a9da-aea0-4013-ac30-83df00bda6dd',
        nullable: false,
        env: 'AZURE_CLIENT_ID'
      },
      federatedTokenFile: {
        doc: 'Azure Federated Token File Path',
        format: String,
        default: null,
        nullable: true,
        env: 'AZURE_FEDERATED_TOKEN_FILE'
      }
    },
    sharepoint: {
      siteId: {
        doc: 'SharePoint Site ID',
        format: String,
        default: null,
        nullable: true,
        env: 'SHAREPOINT_SITE_ID'
      },
      driveId: {
        doc: 'SharePoint Drive ID (Target Library)',
        format: String,
        default: null,
        nullable: true,
        env: 'SHAREPOINT_DRIVE_ID'
      },
      sitePath: {
        doc: 'SharePoint Site Path',
        format: String,
        default: null,
        nullable: true,
        env: 'SHAREPOINT_SITE_PATH'
      },
      driveName: {
        doc: 'SharePoint Drive Name',
        format: String,
        default: null,
        nullable: true,
        env: 'SHAREPOINT_DRIVE_NAME'
      }
    }
  }
})

config.validate({ allowed: 'strict' })
