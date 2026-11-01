# connectors/

Um conector isolado por fonte (PNCP primeiro). A falha de um nunca interrompe os outros.

Contrato mínimo: paginação, retry com backoff exponencial, `User-Agent` identificando o robô, respeito a termos de uso/robots.txt, teste com resposta gravada (fixture) — nunca chamada real no CI.
