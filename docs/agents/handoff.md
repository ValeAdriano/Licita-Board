# Modelo de handoff

Use ao pausar, terminar ou passar uma tarefa para outro agente/sessão. Cole na descrição do PR ou no fim de `em-andamento.md`.

~~~markdown
## Handoff · <branch> · <AAAA-MM-DD> · <agente>

**Objetivo da tarefa:** <1 linha, com link para a spec/seção>

**Feito**
- <item> — testado com `<comando>` ✅ / sem teste ⚠️

**Falta**
- <item>

**Como verificar**
```bash
<comandos exatos>
```

**Decisões tomadas (e por quê)**
- <decisão> — <motivo>. Precisa de ADR? sim/não

**Dúvidas abertas para o Adriano**
1. <pergunta objetiva com opções>

**Riscos / cuidado**
- <ex.: migration depende de X; não mexer em Y>
~~~
