# Chagas Car — Vercel + Neon PostgreSQL

Sistema de oficina mecânica com autenticação por e-mail e senha, múltiplas oficinas isoladas, clientes, veículos, ordens de serviço e histórico completo por placa/cliente.

**Não utiliza Firebase.** A aplicação é hospedada na Vercel e utiliza Neon PostgreSQL como banco persistente.

## O que está incluído

- Cadastro inicial da oficina e do administrador.
- Login e logout com cookie HttpOnly e sessão assinada.
- Cadastro de funcionários pelo administrador.
- Desativação de funcionários.
- Isolamento dos dados por `office_id` nas consultas da API.
- Cadastro de clientes e veículos.
- Placa única por oficina.
- Ordem de serviço com status, quilometragem, peças, serviços, desconto, pagamento, garantia e data de retorno.
- Histórico permanente por placa e por cliente.
- Impressão de ordem de serviço.
- Dados cadastrais da oficina para o recibo.
- Banco relacional com índices e chaves estrangeiras.

## Requisitos

- Conta na Vercel.
- Conta no Neon.
- Repositório GitHub (recomendado para conectar à Vercel).
- Node.js 20 ou superior para desenvolvimento local.

## 1. Criar o banco Neon

1. Acesse https://neon.tech/ e crie um projeto PostgreSQL.
2. No painel do projeto, abra o SQL Editor.
3. Abra o arquivo `schema.sql` deste pacote, copie todo o conteúdo e execute no SQL Editor.
4. No painel de conexão do Neon, copie a connection string PostgreSQL. Prefira a conexão pooled quando disponível.

## 2. Publicar na Vercel

1. Extraia o ZIP.
2. Envie os arquivos para um repositório GitHub privado.
3. Na Vercel, escolha **Add New → Project** e importe o repositório.
4. Framework preset: **Other**.
5. Build Command: deixe vazio.
6. Output Directory: `public`.
7. Em **Settings → Environment Variables**, adicione:

   - `DATABASE_URL` = connection string do Neon.
   - `SESSION_SECRET` = segredo aleatório longo, com no mínimo 32 caracteres.

   Exemplo para gerar um segredo localmente:
   `openssl rand -base64 48`

8. Marque as variáveis para Production (e Preview se desejar).
9. Clique em Deploy.

## 3. Primeiro acesso

1. Abra o endereço publicado na Vercel.
2. Clique em **Cadastrar minha oficina**.
3. Informe o nome da oficina, seu nome, e-mail e senha com pelo menos 8 caracteres.
4. O primeiro cadastro cria a oficina e o usuário administrador.
5. Entre no menu **Usuários** para cadastrar funcionários.

O cadastro inicial é público para permitir criar a primeira oficina. Depois que a oficina estiver criada, não compartilhe o acesso administrativo. Funcionários devem ser criados pelo administrador dentro do sistema.

## Segurança e isolamento

- Senhas são armazenadas com hash bcrypt (12 rounds), nunca em texto puro.
- A sessão é assinada com JWT e guardada em cookie HttpOnly, Secure e SameSite=Lax.
- Todas as consultas de dados de clientes, veículos e ordens são limitadas ao `office_id` da sessão.
- Funcionários não podem gerenciar usuários nem alterar dados gerais da oficina.
- O e-mail é único no sistema. Um mesmo e-mail não pode ser cadastrado em duas oficinas.

## Importante antes de usar em produção

Este pacote é uma base funcional para implantação, mas antes de operar com dados reais, faça um teste completo com dados fictícios e revise:

1. Configure corretamente as duas variáveis de ambiente na Vercel.
2. Execute o `schema.sql` no projeto Neon correspondente.
3. Teste cadastro, login, logout, criação de funcionários e isolamento com duas oficinas diferentes.
4. Teste backup/exportação e rotina de restauração do banco. Este pacote ainda não inclui tela de backup automático.
5. Configure política de backup do Neon e restrinja acesso ao projeto e ao repositório.
6. Adicione fluxo de recuperação de senha por e-mail antes de oferecer acesso amplo aos funcionários.
7. Para uma operação com vários usuários simultâneos, considere adicionar auditoria de alterações, exclusão lógica e regras mais granulares de permissão.

## Estrutura

```text
chagas-car/
├── api/
│   └── [...path].js
├── lib/
│   ├── auth.js
│   └── db.js
├── public/
│   └── index.html
├── schema.sql
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

## Rotas principais

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET/POST /api/customers`
- `PUT /api/customers/:id`
- `GET /api/vehicles`
- `GET/POST /api/orders`
- `GET /api/orders/:id`
- `PUT /api/orders/:id`
- `GET /api/history?plate=ABC1D23`
- `GET /api/history?customer_id=UUID`
- `GET/POST /api/users` (admin)
- `PUT /api/users/:id` (admin)
- `PUT /api/office` (admin)

## Correção de compatibilidade jose v6 / Vercel

O projeto usa `jose` v6 (ESM). O arquivo `lib/auth.js` está em CommonJS e, por isso, carrega `jose` por `import()` dinâmico. Não altere para `require("jose")`, pois isso causa `ERR_REQUIRE_ESM` na Vercel.
