const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const serverless = require('serverless-http');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const { randomUUID } = require('crypto');

// ======================================================
// CONFIGURAÇÃO DA APLICAÇÃO
// ======================================================

const app = express();
const port = process.env.PORT || 5000;

const SERVICE_NAME = 'infra-cloud-backend';
const ENVIRONMENT = process.env.APP_ENV || 'production';

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-2',
});

const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TODOS_TABLE || 'todos';

// ======================================================
// LOGS ESTRUTURADOS
// ======================================================

function sanitizeErrorMessage(message = '') {
  return String(message)
    .replace(
      /(password|senha|token|authorization|secret|api[-_]?key|credential)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[REDACTED]'
    )
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[REDACTED_CONNECTION_STRING]')
    .slice(0, 500);
}

function logEvent(level, event, data = {}) {
  const log = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    environment: ENVIRONMENT,
    level,
    event,
    ...data,
  };

  // Uma linha JSON por evento
  console.log(JSON.stringify(log));
}

function normalizeRoute(req) {
  // Quando Express reconhece a rota, usa o padrão definido.
  // Exemplo: /todos/:id
  if (req.route && req.route.path) {
    return req.route.path;
  }

  // Fallback para rotas não reconhecidas.
  return req.path
    .replace(
      /\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}(?=\/|$)/g,
      '/:id'
    )
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

// Mede e registra cada operação do DynamoDB
async function executeDynamoDB(operation, command, requestId) {
  const start = process.hrtime.bigint();

  try {
    const result = await dynamodb.send(command);

    const duration = Number(process.hrtime.bigint() - start) / 1_000_000;

    logEvent('info', 'dynamodb_operation', {
      requestId,
      operation,
      table: TABLE_NAME,
      result: 'success',
      duration: Number(duration.toFixed(2)),
      durationUnit: 'ms',
    });

    return result;
  } catch (err) {
    const duration = Number(process.hrtime.bigint() - start) / 1_000_000;

    logEvent('error', 'dynamodb_operation', {
      requestId,
      operation,
      table: TABLE_NAME,
      result: 'failure',
      duration: Number(duration.toFixed(2)),
      durationUnit: 'ms',
      errorType: err.name || 'Error',
      errorMessage: sanitizeErrorMessage(err.message),
    });

    throw err;
  }
}

// ======================================================
// MIDDLEWARES
// ======================================================

app.use(
  cors({
    origin: [
      'https://infra-cloud-ten.vercel.app',
      'https://www.sonobackdoend.duckdns.org',
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Mantém compatibilidade com o caminho usado anteriormente
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.use((req, res, next) => {
    const basePath = '/default/infra-cloud-backend';

    if (req.url.startsWith(basePath)) {
      req.url = req.url.slice(basePath.length) || '/';
    }

    next();
  });
}

// Middleware de observabilidade HTTP
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  req.requestId = req.headers['x-request-id'] || randomUUID();

  res.setHeader('X-Request-Id', req.requestId);

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1_000_000;

    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    const logData = {
      requestId: req.requestId,
      method: req.method,
      route: normalizeRoute(req),
      statusCode: res.statusCode,
      result: res.statusCode < 400 ? 'success' : 'failure',
      duration: Number(duration.toFixed(2)),
      durationUnit: 'ms',
    };

    if (res.locals.errorType) {
      logData.errorType = res.locals.errorType;
    }

    if (res.locals.errorMessage) {
      logData.errorMessage = res.locals.errorMessage;
    }

    logEvent(level, 'http_request', logData);
  });

  next();
});

app.use(bodyParser.json());

// ======================================================
// HEALTH CHECK
// ======================================================

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
  });
});

// ======================================================
// GET /todos
// ======================================================

app.get('/todos', async (req, res) => {
  try {
    const result = await executeDynamoDB(
      'Scan',
      new ScanCommand({
        TableName: TABLE_NAME,
      }),
      req.requestId
    );

    res.json(result.Items || []);
  } catch (err) {
    res.locals.errorType = err.name || 'Error';
    res.locals.errorMessage = sanitizeErrorMessage(err.message);

    res.status(500).json({
      message: 'Erro interno do servidor',
    });
  }
});

// ======================================================
// POST /todos
// ======================================================

app.post('/todos', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    res.locals.errorType = 'ValidationError';
    res.locals.errorMessage = 'Campo text obrigatório';

    return res.status(400).json({
      message: 'O campo "text" é obrigatório',
    });
  }

  const todo = {
    id: randomUUID(),
    text,
    completed: false,
  };

  try {
    await executeDynamoDB(
      'PutItem',
      new PutCommand({
        TableName: TABLE_NAME,
        Item: todo,
      }),
      req.requestId
    );

    res.status(201).json(todo);
  } catch (err) {
    res.locals.errorType = err.name || 'Error';
    res.locals.errorMessage = sanitizeErrorMessage(err.message);

    res.status(500).json({
      message: 'Erro interno do servidor',
    });
  }
});

// ======================================================
// PATCH /todos/:id
// ======================================================

app.patch('/todos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const current = await executeDynamoDB(
      'GetItem',
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id },
      }),
      req.requestId
    );

    if (!current.Item) {
      res.locals.errorType = 'NotFound';
      res.locals.errorMessage = 'Tarefa não encontrada';

      return res.status(404).json({
        message: 'Tarefa não encontrada',
      });
    }

    const updatedCompleted = !current.Item.completed;

    const result = await executeDynamoDB(
      'UpdateItem',
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id },
        UpdateExpression: 'SET completed = :completed',
        ExpressionAttributeValues: {
          ':completed': updatedCompleted,
        },
        ReturnValues: 'ALL_NEW',
      }),
      req.requestId
    );

    res.json(result.Attributes);
  } catch (err) {
    res.locals.errorType = err.name || 'Error';
    res.locals.errorMessage = sanitizeErrorMessage(err.message);

    res.status(500).json({
      message: 'Erro interno do servidor',
    });
  }
});

// ======================================================
// DELETE /todos/:id
// ======================================================

app.delete('/todos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const current = await executeDynamoDB(
      'GetItem',
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id },
      }),
      req.requestId
    );

    if (!current.Item) {
      res.locals.errorType = 'NotFound';
      res.locals.errorMessage = 'Tarefa não encontrada';

      return res.status(404).json({
        message: 'Tarefa não encontrada',
      });
    }

    await executeDynamoDB(
      'DeleteItem',
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { id },
      }),
      req.requestId
    );

    res.json({
      message: 'Tarefa excluída com sucesso',
    });
  } catch (err) {
    res.locals.errorType = err.name || 'Error';
    res.locals.errorMessage = sanitizeErrorMessage(err.message);

    res.status(500).json({
      message: 'Erro interno do servidor',
    });
  }
});

// ======================================================
// EXECUÇÃO LOCAL OU AWS LAMBDA
// ======================================================

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  module.exports.handler = serverless(app);
} else {
  app.listen(port, () => {
    logEvent('info', 'server_started', {
      port,
      result: 'success',
    });
  });
}
