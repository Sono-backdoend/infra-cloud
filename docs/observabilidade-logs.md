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