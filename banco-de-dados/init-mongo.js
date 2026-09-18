db = db.getSiblingDB('todo-app');

db.createCollection('todos');

// Usa um campo "id" (string) em vez do _id padrão do Mongo,
// para manter o mesmo formato de item usado no DynamoDB em produção.
db.todos.insertMany([
  { id: "5f2f3f3a-0000-4000-8000-000000000001", text: "Laércio é um excelente professor", completed: false },
  { id: "5f2f3f3a-0000-4000-8000-000000000002", text: "Estudar Cloud", completed: true },
  { id: "5f2f3f3a-0000-4000-8000-000000000003", text: "Fazer exercícios da UA", completed: false },
]);

db.todos.createIndex({ id: 1 }, { unique: true });
