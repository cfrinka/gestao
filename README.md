# Gestão Loja - Sistema de Gestão para Loja com Dois Proprietários

Sistema completo de gestão para loja de roupas com dois proprietários, desenvolvido com Next.js 14, Firebase e Shadcn UI.

## Funcionalidades

### Gestão de Vendas
- **PDV (Ponto de Venda)**: Interface intuitiva para vendas
- **Uma transação para o cliente**: O cliente vê apenas um pedido, um recibo e um pagamento
- **Divisão interna por proprietário**: Sistema separa automaticamente itens, custos, receitas e lucros

### Contabilidade por Proprietário
- Cada produto pertence a um proprietário
- Cálculo automático de custo, receita e lucro por proprietário
- Registro em OwnerLedger para cada venda

### Relatórios
- Receita total por proprietário
- Custo total por proprietário
- Lucro total por proprietário
- Margem de lucro
- Valor do estoque
- Filtros por data (dia/mês/período)

### Controle de Estoque
- Estoque por proprietário
- Valor do inventário (estoque × preço de custo)
- Baixa automática na venda

### Controle de Acesso
- **Admin**: Acesso total
- **Owner (Proprietário)**: Acesso aos próprios produtos, inventário e lucros
- **Cashier (Caixa)**: Apenas PDV e vendas

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

### 3. Instale as dependências

```bash
npm install
```

### 4. Popule o banco com dados de exemplo

```bash
npm run seed
```

### 5. Inicie o servidor de desenvolvimento

```bash
npm run dev
```

## Usuários de Teste

Após executar o seed, os seguintes usuários estarão disponíveis:

| Email | Senha | Função |
|-------|-------|--------|
| admin@loja.com | admin123 | Administrador |
| proprietario1@loja.com | owner123 | Proprietário 1 |
| proprietario2@loja.com | owner123 | Proprietário 2 |
| caixa@loja.com | caixa123 | Caixa |

## Tecnologias

- **Framework**: Next.js 14 (App Router)
- **Banco de Dados**: Firebase Firestore
- **Autenticação**: Firebase Authentication
- **UI**: Shadcn UI + Tailwind CSS
- **Ícones**: Lucide React
- **Exportação**: jsPDF + jspdf-autotable

## Estrutura do Projeto

```
src/
├── app/
│   ├── (dashboard)/       # Páginas protegidas
│   │   ├── dashboard/     # Dashboard principal
│   │   ├── pos/           # Ponto de Venda
│   │   ├── products/      # Gestão de Produtos
│   │   ├── sales/         # Histórico de Vendas
│   │   ├── inventory/     # Controle de Estoque
│   │   ├── reports/       # Relatórios
│   │   ├── owners/        # Gestão de Proprietários
│   │   └── users/         # Gestão de Usuários
│   ├── api/               # API Routes
│   └── login/             # Página de Login
├── components/
│   ├── layout/            # Componentes de Layout
│   └── ui/                # Componentes Shadcn UI
├── contexts/
│   └── auth-context.tsx   # Contexto de Autenticação Firebase
├── lib/
│   ├── firebase.ts        # Cliente Firebase
│   ├── firebase-admin.ts  # Firebase Admin SDK
│   ├── db.ts              # Funções de Banco de Dados
│   └── utils.ts           # Utilitários
└── types/                 # Tipos TypeScript
```

## Coleções do Firestore

- **owners**: Proprietários da loja
- **products**: Produtos (com ownerId)
- **orders**: Pedidos (transação única)
- **orderItems**: Itens do pedido (com cálculos)
- **ownerLedgers**: Registro financeiro por proprietário/pedido
- **users**: Usuários do sistema (sincronizado com Firebase Auth)

## Lógica de Checkout

1. Cria um único documento em `orders`
2. Para cada produto:
   - Cria documento em `orderItems` com cálculos de custo, receita e lucro
3. Agrupa itens por proprietário
4. Cria documento em `ownerLedgers` para cada proprietário
5. Atualiza estoque dos produtos
6. Tudo em uma transação batch do Firestore

## Exportação

- **CSV**: Exportação de vendas e relatórios
- **PDF**: Relatórios financeiros com formatação profissional
