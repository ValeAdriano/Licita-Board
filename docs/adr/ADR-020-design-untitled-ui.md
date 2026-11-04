# ADR-020 · Design system: Untitled UI (React, react-aria, Tailwind 4) no lugar do design Apple próprio

- **Status:** Aceito (2026-11-04)
- **Data:** 2026-11-04
- **Decisor:** Adriano Vale ("quero que todos os componentes de UI sejam untitledui, e deve seguir os padrões de layout")
- **Requisito relacionado:** ADR-018 (front React em PWA; a parte de design Apple é substituída aqui), `apps/web/AGENTS.md`

## Decisão

- Todos os componentes de UI vêm do **Untitled UI React** (componentes gratuitos, MIT, copiados para `apps/web/src/components` pelo CLI `untitledui`): botão, campo, seleção, caixa, toggle, rádio, selo (badge), abas, tabela, modal, paginação e carregamento. Sem componente PRO.
- **Base técnica:** Tailwind CSS 4 (`@tailwindcss/vite`), `react-aria-components` (acessibilidade e teclado), `@untitledui/icons`, `tailwind-merge`, `tailwindcss-animate`, `tailwindcss-react-aria-components`, `@tailwindcss/typography` e a fonte **Inter** local (`@fontsource-variable/inter`, OFL; a CSP não permite fonte externa). Cor da marca: azul (`brand` = Tailwind `blue`).
- **Camada fina em `src/ui`** (nomes em português) sobre os componentes do Untitled UI, para as telas não dependerem dos detalhes deles: `Botao`, `Campo`, `Selecao`, `Caixa`, `Interruptor`, `AreaTexto`, `Arquivo`, `Abas`, `Etiqueta`, `Aviso`, `Modal`, `TelaAcesso`, `FaixaAmbiente`, `Marca` e as peças de layout (`Pagina`, `CabecalhoPagina`, `Cartao`, `Pilha`, `Linha`, `Legenda`, `Vazio`). Tela nova usa `src/ui` ou `src/components`; **não** escreve CSS próprio.
- **Layout (padrões do Untitled UI):** menu lateral fixo a partir de 1024 px; no celular, cabeçalho com botão que abre o menu em painel; página com cabeçalho (título, descrição, ações), conteúdo em cartões, abas sublinhadas, alerta com ícone, listas em cartão. Tela de acesso em cartão centrado. A empresa selecionada fica no topo do menu.
- O CSS antigo (`estilos.css`, tokens `--acento`, `--e1..`) e o `lucide-react` saem.

## Ajustes nos componentes copiados (são do repositório, não de uma biblioteca)

- `Label`: o asterisco de "obrigatório" só existe quando o campo pode ser obrigatório (o app não usa), para não entrar no nome acessível.
- `TextArea`: sem a imagem `data:` do resizer (a CSP só aceita `img-src 'self'`).
- Logotipo e exemplos do Untitled UI removidos; `Marca` é o monograma VV.

## CSP

O react-aria injeta em runtime um `<style>` de `usePress`. A CSP ganhou **o hash** desse estilo em `style-src` (nunca `unsafe-inline`). Atualizou o `react-aria-components`? Se o console acusar "Applying inline style", troque o hash (Caddyfile, `apps/web/AGENTS.md` e `infra/caddy/testar-cabecalhos.sh`).

## Consequências

- Mais dependências no front (todas MIT/OFL); bundle de CSS maior (~165 KB, com tema e tipografia do Untitled UI).
- Componentes copiados ficam sob nossa manutenção: atualização é por `npx untitledui add <nome> --overwrite`, depois reaplicar os ajustes acima.
- Tabelas ainda estão como listas em cartão; migrar para o componente `Table` onde houver muitas colunas (Equipe, Auditoria, Empresas) é a próxima etapa.
