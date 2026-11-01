# rules/

Código puro e determinístico: prazos (`prazos.py`), preços (`precos.py`), unidades (`unidades.py`).

- Sem I/O, sem banco, sem IA. Entrada e saída tipadas.
- Dinheiro só em `decimal.Decimal`. `float` é proibido (Semgrep bloqueia).
- Cobertura mínima de 80% (Prompt Mestre 0.4); `precos.py` exige 100%.
- Regra jurídica ou tributária nunca é suposta: vem de `pub.regras_prazo` / parâmetros validados pelo jurídico ou contador.
