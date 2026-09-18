# Observabilidade - Coleta, Retencao e Consulta de Logs

## 1. Objetivo

Esta configuracao tem como objetivo garantir que os logs gerados pelo back-end sejam coletados, armazenados por um periodo definido e possam ser consultados para analise operacional e construcao dos paineis de observabilidade.

## 2. Origem dos logs

Os logs sao gerados pelo back-end executado na AWS Lambda:

- Servico: `infra-cloud-backend`
- Ambiente: `production`
- Formato: JSON estruturado
- Regiao AWS: `us-east-2`

Foram definidos dois principais tipos de eventos:

- `http_request`: registra as requisicoes HTTP recebidas pelo back-end.
- `dynamodb_operation`: registra as operacoes executadas pelo back-end no DynamoDB.

Os logs HTTP possuem campos como:

- timestamp
- service
- environment
- level
- event
- requestId
- method
- route
- statusCode
- result
- duration
- durationUnit
- errorType e errorMessage, quando aplicavel

Os logs do DynamoDB possuem:

- timestamp
- service
- environment
- level
- event
- requestId
- operation
- table
- result
- duration
- durationUnit
- errorType e errorMessage, quando aplicavel

## 3. Coleta dos registros

Os eventos sao emitidos pela aplicacao utilizando logs estruturados em JSON.

A Lambda envia os registros de execucao para o Amazon CloudWatch Logs.

Fluxo:

Lambda `infra-cloud-backend`
→ log estruturado em JSON
→ CloudWatch Logs
→ Logs Insights
→ consultas e paineis

## 4. Armazenamento

Os registros ficam armazenados no grupo:

`/aws/lambda/infra-cloud-backend`

Esse grupo concentra os eventos gerados pela Lambda do back-end.

## 5. Retencao

Foi configurado um periodo de retencao de:

**14 dias**

A escolha permite manter os registros necessarios para analise, testes e evidencias da atividade sem armazenar logs indefinidamente.

Apos esse periodo, os registros antigos sao removidos conforme a politica de retencao configurada no CloudWatch.

## 6. Consulta dos logs

A ferramenta utilizada para consulta e o Amazon CloudWatch Logs Insights.

Foram salvas duas consultas principais.

### 6.1 Requisicoes HTTP

Nome da consulta salva:

`http-requests-aplicacao`

Consulta:

```sql
fields @timestamp, method, route, statusCode, result, duration, requestId
| filter event = "http_request"
| filter route = "/health" or route = "/todos" or route = "/todos/:id"
| sort @timestamp desc
| limit 50

```

Essa consulta permite identificar:

- rota acessada;
- metodo HTTP;
- codigo de resposta;
- sucesso ou falha;
- duracao da requisicao;
- identificador de correlacao.

As rotas sao padronizadas. Por exemplo, uma chamada real como:

`PATCH /todos/11111111-1111-4111-8111-111111111111`

e registrada como:

`PATCH /todos/:id`

Isso permite agrupar corretamente as requisicoes por rota.

### 6.2 Operacoes do DynamoDB

Nome da consulta salva:

`dynamodb-operacoes`

Consulta:

```sql
fields @timestamp, operation, table, result, duration, requestId
| filter event = "dynamodb_operation"
| sort @timestamp desc
| limit 50
```

Essa consulta permite visualizar operacoes como:

- Scan
- GetItem
- PutItem
- UpdateItem
- DeleteItem

Tambem permite analisar o resultado e o tempo de execucao de cada operacao.

## 7. Correlacao entre os eventos

Os eventos HTTP e as operacoes de banco utilizam o mesmo `requestId`.

Exemplo real observado:

`requestId: 8ad8c269-970c-4d36-a318-d800be7ff042`

A requisicao:

`POST /todos`

foi concluida com:

- status HTTP: 201
- resultado: success
- duracao: 301.12 ms

Durante a mesma requisicao foi executada a operacao:

`PutItem`

no DynamoDB, com:

- tabela: `todos`
- resultado: success
- duracao: 117.69 ms

O mesmo `requestId` permite relacionar a requisicao HTTP com a operacao executada no banco.

## 8. Exemplo de falha controlada

Tambem foi realizado um teste com um identificador inexistente utilizando:

`PATCH /todos/:id`

O back-end executou um `GetItem` no DynamoDB corretamente, mas nenhum item correspondente foi encontrado.

O resultado HTTP foi:

- statusCode: 404
- result: failure
- errorType: NotFound
- errorMessage: `Tarefa nao encontrada`

Esse teste demonstra que e possivel diferenciar uma falha na infraestrutura de banco de um resultado funcional da aplicacao.

## 9. Relacao com os paineis

Os eventos `http_request` podem ser utilizados para alimentar paineis de:

- desempenho por rota;
- quantidade de requisicoes;
- erros e taxa de erro.

Campos principais:

- route
- method
- statusCode
- result
- duration

Os eventos `dynamodb_operation` podem alimentar o painel de operacoes do banco de dados.

Campos principais:

- operation
- table
- result
- duration

## 10. Seguranca

Os logs nao registram:

- senhas;
- tokens;
- cabecalho Authorization;
- credenciais;
- chaves de API;
- strings de conexao;
- dados pessoais desnecessarios.

Os registros sao limitados a informacoes operacionais necessarias para observabilidade e diagnostico.

## 11. Limitacoes

A ausencia de registros em determinado periodo nao significa, por si so, que a aplicacao estava funcionando corretamente. Pode significar apenas que nenhuma requisicao foi realizada naquele intervalo.

O dominio publico tambem recebe requisicoes automatizadas para rotas que nao pertencem a aplicacao, como `/.env`, `/.git/config` e outras.

Esses acessos recebem resposta HTTP 404, mas foram excluidos das consultas funcionais da aplicacao para nao distorcer indicadores como taxa de erro.

Para os indicadores da aplicacao sao consideradas principalmente as rotas:

- `/health`
- `/todos`
- `/todos/:id`

## 12. Evidencias realizadas

Foram verificadas no ambiente real:

1. Retencao de 14 dias no grupo `/aws/lambda/infra-cloud-backend`.
2. Consulta de requisicoes HTTP utilizando Logs Insights.
3. Consulta de operacoes DynamoDB utilizando Logs Insights.
4. Criacao de tarefas com `POST /todos`.
5. Consulta de tarefas com `GET /todos`.
6. Exclusao de tarefas com `DELETE /todos/:id`.
7. Operacoes `PutItem`, `GetItem`, `Scan` e `DeleteItem` observadas nos logs.
8. Correlacao entre eventos HTTP e DynamoDB utilizando `requestId`.
9. Falha controlada com resposta HTTP 404 e erro `NotFound`.

Todos os dados utilizados nas evidencias foram gerados pelo ambiente real da aplicacao.