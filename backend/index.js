const path = require('path');

// Em produção (Lambda) as variáveis já vêm do ambiente da própria função,
// então só carregamos um arquivo .env-<NODE_ENV> quando rodando localmente.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  require('dotenv').config({
    path: path.resolve(__dirname, `.env.${process.env.NODE_ENV || 'development'}`),
  });
}

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

const { MongoClient } = require('mongodb');

const { randomUUID } = require('crypto');

// ======================================================
// CONFIGURAÇÃO DA APLICAÇÃO
// ======================================================

const app = express();
const port = process.env.PORT || 5000;

const SERVICE_NAME = 'infra-cloud-backend';
const ENVIRONMENT = process.env.APP_ENV || 'development';

// Em produção (Lambda) o padrão continua sendo DynamoDB.
// Para rodar localmente contra o MongoDB do docker-compose, defina DB_ENGINE=mongo no .env.
const DB_ENGINE = (process.env.DB_ENGINE || 'dynamodb').toLowerCase();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'infra_cloud';
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || 'todos';

let mongoClient;
let todosCollection;

async function connectToMongo() {
  mongoClient = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });

  await mongoClient.connect();

  const db = mongoClient.db(MONGO_DB);
  todosCollection = db.collection(MONGO_COLLECTION);

  logEvent('info', 'mongodb_connected', {
    database: MONGO_DB,
    collection: MONGO_COLLECTION,
  });
}

async function executeMongo(operation, fn, requestId) {
  const start = process.hrtime.bigint();

  try {
    const result = await fn();

    const duration = Number(process.hrtime.bigint() - start) / 1_000_000;

    logEvent('info', 'mongodb_operation', {
      requestId,
      operation,
      collection: MONGO_COLLECTION,
      result: 'success',
      duration: Number(duration.toFixed(2)),
      durationUnit: 'ms',
    });

    return result;
  } catch (err) {
    const duration = Number(process.hrtime.bigint() - start) / 1_000_000;

    logEvent('error', 'mongodb_operation', {
      requestId,
      operation,
      collection: MONGO_COLLECTION,
      result: 'failure',
      duration: Number(duration.toFixed(2)),
      durationUnit: 'ms',
      errorType: err.name || 'Error',
      errorMessage: sanitizeErrorMessage(err.message),
    });

    throw err;
  }
}

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
      // Porta 80 é a padrão do HTTP, então o navegador manda o Origin sem
      // ":80" quando o frontend local (docker-compose/nginx) roda nela.
      'http://localhost',
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
    if (DB_ENGINE === 'mongo') {
      const items = await executeMongo(
        'find',
        () => todosCollection.find({}, { projection: { _id: 0 } }).toArray(),
        req.requestId
      );

      return res.json(items);
    }

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
    if (DB_ENGINE === 'mongo') {
      // Passa uma cópia: o driver do Mongo muta o objeto do insertOne
      // adicionando _id, e não queremos vazar esse campo na resposta.
      await executeMongo(
        'insertOne',
        () => todosCollection.insertOne({ ...todo }),
        req.requestId
      );

      return res.status(201).json(todo);
    }

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


// CONSULTA A API DE HORAS DO PROFESSOR
app.get('/todos/horas', async (req, res) => {
  try {
    const ra = req.query.ra;
    if (!ra) {
      return res.status(400).json({ message: 'O parâmetro "ra" é obrigatório' });
    }

    const response = await fetch(process.env.API_HORAS_URL + 'hours?ra=' + ra, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.API_HORAS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return res.status(response.status).json({ message: `Erro ao buscar horas: ${errorBody}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.locals.errorType = err.name || 'Error';
    // "fetch failed" (undici) só embrulha a causa real (DNS, TLS, conexão
    // recusada etc.), que fica em err.cause — sem isso o log não diz nada.
    const causeMessage = err.cause ? `${err.message}: ${err.cause.message || err.cause}` : err.message;
    res.locals.errorMessage = sanitizeErrorMessage(causeMessage);

    res.status(500).json({
      message: 'Erro ao consultar horas do usuário',
    });
  }
});

// ======================================================
// PATCH /todos/:id
// ======================================================

app.patch('/todos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (DB_ENGINE === 'mongo') {
      const current = await executeMongo(
        'findOne',
        () => todosCollection.findOne({ id }, { projection: { _id: 0 } }),
        req.requestId
      );

      if (!current) {
        res.locals.errorType = 'NotFound';
        res.locals.errorMessage = 'Tarefa não encontrada';

        return res.status(404).json({
          message: 'Tarefa não encontrada',
        });
      }

      const updatedCompleted = !current.completed;

      await executeMongo(
        'updateOne',
        () =>
          todosCollection.updateOne(
            { id },
            { $set: { completed: updatedCompleted } }
          ),
        req.requestId
      );

      return res.json({ ...current, completed: updatedCompleted });
    }

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
    if (DB_ENGINE === 'mongo') {
      const current = await executeMongo(
        'findOne',
        () => todosCollection.findOne({ id }, { projection: { _id: 0 } }),
        req.requestId
      );

      if (!current) {
        res.locals.errorType = 'NotFound';
        res.locals.errorMessage = 'Tarefa não encontrada';

        return res.status(404).json({
          message: 'Tarefa não encontrada',
        });
      }

      await executeMongo(
        'deleteOne',
        () => todosCollection.deleteOne({ id }),
        req.requestId
      );

      return res.json({
        message: 'Tarefa excluída com sucesso',
      });
    }

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

async function start() {
  if (DB_ENGINE === 'mongo') {
    await connectToMongo();
  }

  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    module.exports.handler = serverless(app);
  } else {
    app.listen(port, () => {
      logEvent('info', 'server_started', {
        port,
        dbEngine: DB_ENGINE,
        result: 'success',
      });
    });
  }
}

start();
