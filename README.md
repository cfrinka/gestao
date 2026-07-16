# Gestão Loja

Sistema de gestão para loja de roupas (PDV, estoque, financeiro e clientes), construído com Next.js 14 (App Router), Firebase (Auth + Firestore) e Shadcn UI.

## Funcionalidades

### PDV (Ponto de Venda) — `/pos`
- Carrinho com busca por produto/SKU/tamanho e leitura de código de barras
- Descontos configuráveis: fixo, PIX, progressivo por quantidade de itens (1, 2, 3 ou 4+) e por produto
- Limite de desconto para o papel de Caixa, com autorização pontual do Admin (via senha) para exceder o limite — a autorização é single-use e expira em 5 minutos
- Baixa de estoque, cálculo de comissão e conciliação com o caixa aberto, tudo na mesma transação de checkout

### Caixa — sessões de caixa
- Abertura/fechamento de caixa por usuário, com suprimento e sangria
- Total por forma de pagamento (dinheiro, débito, crédito, PIX), diferenças de troca e pagamentos de fiado lançados no caixa
- Abertura protegida contra corrida (dois "abrir caixa" simultâneos do mesmo usuário nunca resultam em dois caixas abertos)

### Trocas — `/exchanges`
- Troca de produtos com ajuste de estoque nos dois lados e lançamento de diferença de valor (a favor da loja ou do cliente) no caixa aberto

### Clientes e Fiado — `/clients`
- Cadastro de clientes, saldo devedor (fiado) e pagamento parcial ou total
- Correções manuais de débito com trilha de auditoria (`/debt-corrections`)

### Produtos e Estoque — `/products`, `/inventory`, `/stock-entries`
- Cadastro de produtos com tamanhos, categoria, preço de custo/venda e SKU único (protegido contra duplicidade mesmo em criações concorrentes)
- Entrada de estoque na criação/edição do produto e ajustes manuais de estoque (recontagem, perda etc.), cada ajuste gerando um registro de auditoria
- Histórico de entradas de estoque por dia/mês (`/stock-entries`)
- Categorização em lote e sincronização de origem de imagem (`/products/categories`)

### Financeiro
- Contas a pagar (`/bills`), fornecedores (`/suppliers`)
- Fechamento de mês competente (`financialClosures`) — bloqueia novas escritas financeiras retroativas ao mês fechado
- Checagem de saúde financeira automatizável via endpoint com segredo compartilhado (cron/automação), além de sob demanda pelo Admin
- Comissão de vendas (3% sobre o valor vendido) por usuário Caixa, com job de reconciliação idempotente (`/comission`)

### Relatórios — `/reports`, `/sales`, `/sales-month`
- Receita, custo, lucro e margem, com filtro por dia/mês/período
- Valor de estoque, vendas mensais agregadas

### Código de Barras — `/barcodes`
- Geração e impressão de códigos de barras por produto/tamanho

### Usuários e Acesso — `/users`
- Dois papéis: **Admin** (acesso total) e **Caixa** (PDV, vendas, trocas, comissão e dashboard)
- Criação/desativação de usuário mexe em dois sistemas (Firebase Auth + Firestore) sem transação conjunta entre eles — desativação reverte o lado já aplicado se o outro falhar, e uma falha na própria reversão é registrada em `syncErrors` para conciliação manual em vez de ser silenciosamente ignorada
- Conta de demonstração provisionável por um Admin (`/api/users/demo`), com todas as escritas bloqueadas

## Arquitetura

Todo domínio com regra de negócio real segue o mesmo padrão em camadas:

```
*-service.ts              → regras de negócio, validação, permissões, orquestra idempotência
  → repository.ts          → interface do domínio
    → firestore-*-repository.ts → implementação Firestore da interface
      → *-db.ts             → acesso cru ao Firestore (transações, leitura sempre antes de escrita)
```

Domínios que são só CRUD ou somente leitura (`settings`, `suppliers`, `debt-corrections`, `stock-entries`) acessam o `*-db.ts` direto pela rota, sem a camada de service/repository — a uniformização é aplicar o padrão completo onde há lógica de negócio de verdade, não em todo lugar.

Mecanismos compartilhados entre domínios:
- **Idempotência** (`src/domains/shared/idempotency.ts`): chave de idempotência por requisição, guardada em `idempotencyKeys/{scope}:{ownerId}:{key}` com estados `PROCESSING/COMPLETED/FAILED`, usada em toda escrita que poderia ser duplicada por um duplo clique ou uma nova tentativa de rede (checkout, trocas, contas, ajuste de estoque, ajuste de caixa, compra de estoque, criação de usuário)
- **Documento-marcador em chave natural**: usado para emular unicidade no Firestore onde uma query simples não é segura contra corrida (ex.: `skuIndex/{sku}` para SKU único, `openCashRegisterMarkers/{userId}` para "só um caixa aberto por vez")
- **HttpError** (`src/lib/api/http-errors.ts`) + `withAuthorizedRoute` (`src/lib/api/authorized-route.ts`): toda rota de API autentica, checa papel (`ADMIN`/`CASHIER`/`SYSTEM`), bloqueia escrita da conta demo e converte erros em respostas HTTP tipadas

## Tecnologias

- **Framework**: Next.js 14 (App Router) + React 18 + TypeScript
- **Banco de Dados**: Firebase Firestore (via `firebase-admin` no servidor)
- **Autenticação**: Firebase Authentication (Email/Password)
- **UI**: Shadcn UI + Tailwind CSS + Lucide React
- **Validação**: Zod
- **Exportação**: jsPDF + jspdf-autotable, JsBarcode
- **Testes**: Vitest (testes unitários de service contra repositório fake em memória)

## Instalação

### 1. Configure o Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com)
2. Habilite **Authentication** com Email/Password
3. Habilite **Firestore Database**
4. Gere uma chave privada do Service Account em Configurações > Contas de Serviço
5. Copie as credenciais do Firebase Web App

### 2. Configure as variáveis de ambiente

Copie `.env.example` para `.env` e preencha com suas credenciais Firebase:

```bash
cp .env.example .env
```

Variáveis usadas:

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Client SDK (browser) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Client SDK (browser) |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Client SDK (browser) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Client SDK (browser) |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Client SDK (browser) |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Client SDK (browser) |
| `FIREBASE_PROJECT_ID` | Firebase Admin SDK (servidor) |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin SDK (servidor) |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK (servidor) |
| `FINANCIAL_AUTOMATION_SECRET` | (opcional) segredo para chamar `/api/automation/financial-health` sem login, a partir de um cron externo |

### 3. Instale as dependências

```bash
npm install
```

### 4. Inicie o servidor de desenvolvimento

```bash
npm run dev
```

Não há script de seed/dados de exemplo no momento — crie o primeiro usuário Admin diretamente no Firebase Console (Authentication + um documento em `users/{uid}` com `role: "ADMIN"`).

## Scripts

```bash
npm run dev      # servidor de desenvolvimento
npm run build    # build de produção
npm run start    # servidor de produção
npm run lint     # eslint
npm test         # vitest run
```

## Deploy das regras do Firestore

O projeto Firebase (`loja-7cb7b`) já está configurado em `.firebaserc`/`firebase.json`. Para publicar `firestore.rules`:

```bash
npx firebase deploy --only firestore:rules
```

## Estrutura do Projeto

```
src/
├── app/
│   ├── (dashboard)/          # Páginas protegidas (layout com sidebar por papel)
│   │   ├── dashboard/        # Visão geral
│   │   ├── pos/              # PDV
│   │   ├── products/         # Produtos (+ categories/ para categorização em lote)
│   │   ├── inventory/        # Ajustes manuais de estoque
│   │   ├── stock-entries/    # Histórico de entradas de estoque
│   │   ├── sales/            # Histórico de vendas
│   │   ├── sales-month/      # Vendas mensais agregadas
│   │   ├── exchanges/        # Trocas
│   │   ├── clients/          # Clientes e fiado
│   │   ├── debt-corrections/ # Correções manuais de débito
│   │   ├── bills/            # Contas a pagar
│   │   ├── suppliers/        # Fornecedores
│   │   ├── comission/        # Comissão de vendas
│   │   ├── reports/          # Relatórios financeiros
│   │   ├── barcodes/         # Geração de código de barras
│   │   ├── users/            # Usuários e papéis
│   │   └── settings/         # Descontos, senha de admin (correções de débito), categorias
│   ├── api/                  # Rotas de API (uma por domínio)
│   └── login/                # Login
├── domains/                  # Lógica de negócio, em camadas por domínio (ver Arquitetura)
│   ├── checkout/ exchanges/ orders/ clients/ bills/ comission/
│   ├── cash-register/ products/ stock-adjustments/ users/ financial/
│   ├── suppliers/ settings/ reports/
│   └── shared/                # idempotência, serializers de Firestore
├── lib/
│   ├── firebase.ts            # Client SDK
│   ├── firebase-admin.ts      # Admin SDK
│   ├── api/                   # HttpError, withAuthorizedRoute
│   ├── auth-api.ts            # verificação de token no servidor
│   ├── discount-authorization.ts # grant de exceção ao limite de desconto do Caixa
│   ├── db-types.ts            # tipos compartilhados de domínio
│   └── utils.ts
├── contexts/
│   └── auth-context.tsx       # Contexto de autenticação (Firebase Client SDK)
└── components/
    ├── layout/                 # Sidebar, header
    └── ui/                     # Componentes Shadcn UI
```

## Principais Coleções do Firestore

| Coleção | Conteúdo |
|---|---|
| `products`, `skuIndex` | Produtos e índice de unicidade de SKU |
| `orders`, `orderItems` | Vendas e seus itens |
| `cashRegisters`, `openCashRegisterMarkers` | Sessões de caixa e marcador de "caixa já aberto" |
| `exchanges` | Trocas |
| `clients`, `debtCorrections` | Clientes, saldo de fiado e correções manuais |
| `bills` | Contas a pagar |
| `suppliers` | Fornecedores |
| `stockPurchases`, `stockAdjustments` | Entradas de estoque e ajustes manuais |
| `financialMovements`, `financialClosures`, `financialAuditLogs` | Lançamentos financeiros, fechamento de mês e auditoria |
| `financialMonthlyAggregates`, `financialClosurePreviews`, `financialAutomationRuns` | Agregados e execuções da automação financeira |
| `users`, `syncErrors` | Usuários e falhas de sincronização Auth↔Firestore pendentes de conciliação manual |
| `discountAuthorizations` | Autorização pontual de desconto acima do limite do Caixa |
| `idempotencyKeys` | Estado de idempotência compartilhado entre domínios |
| `settings` | Configuração de descontos (fixo, PIX, progressivo, por produto) |
| `reportCache` | Cache de relatórios |
