# apps/app · regras locais

App do VV Licitações em Expo (React Native + TS) para iOS, Android e Web (ADR-016). Complementa o `AGENTS.md` da raiz.

- Rotas em `src/app/` (Expo Router): todo arquivo ali é tela; `_layout.tsx` define navegadores. Código que não é rota fica fora de `src/app/` (`src/ui`, `src/api`, `src/features/<modulo>`).
- Dependência nova com `npx expo install <pacote>` (resolve a versão compatível com o SDK) e registro no commit/PR.
- Expo muda a cada SDK: confira a documentação da versão do `expo` em `package.json` (https://docs.expo.dev/versions/) antes de usar uma API.
- O app fala **só com a API** (`EXPO_PUBLIC_API_URL`). Nada de credencial de banco, S3, worker ou chave-mestra aqui: tudo que começa com `EXPO_PUBLIC_` vai para o bundle público.
- Sessão: token opaco no `expo-secure-store` no nativo; cookie HttpOnly no web (ADR-012). Nunca em `AsyncStorage`/`localStorage`.
- Toda tela nasce em 360 px; layout largo é melhoria. Recurso incompleto aparece como **EM DESENVOLVIMENTO**.
- Checks: `npm run lint && npm run typecheck && npm test`. `ios/` e `android/` são gerados (CNG): não edite à mão.
