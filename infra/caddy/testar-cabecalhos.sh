#!/usr/bin/env bash
# Confere o Caddyfile de verdade: sobe o Caddy (Docker) apontando para o build do front e para uma API
# de mentira, e confere cabeçalhos, cache, fallback do app, o que chega na API e o que vai para o log.
#
# Uso: infra/caddy/testar-cabecalhos.sh        (precisa de Docker, curl e python3; roda no CI)
# Só funciona em Linux: usa a rede do host (`--network host`); no macOS rode pelo CI.
# Antes: npm ci --prefix apps/web && npm run build --prefix apps/web
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGEM="${CADDY_IMAGEM:-caddy:2.10}"
PORTA=18080
API_PORTA=13000
DIST="$RAIZ/apps/web/dist"
[ -f "$DIST/index.html" ] || { echo "Falta o build do front: npm run build --prefix apps/web" >&2; exit 2; }

tmp="$(mktemp -d)"
cleanup() { docker rm -f vv-caddy-teste >/dev/null 2>&1 || true; kill "${API_PID:-}" 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT

# API de mentira: devolve em JSON os cabeçalhos que recebeu. Imita a API real (nosniff, no-store) e, de
# propósito, manda lixo que o Caddy deve corrigir ou tirar (CSP fraca, X-Powered-By, Set-Cookie).
cat > "$tmp/api.py" <<'PY'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        sem_cache = self.path.startswith("/sem-cache")
        corpo = json.dumps({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if not sem_cache:
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src *")
        self.send_header("X-Powered-By", "Express")
        self.send_header("Set-Cookie", "__Host-sessao=segredo-resp-nao-pode-vazar; Path=/; Secure; HttpOnly")
        self.end_headers()
        self.wfile.write(corpo)
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$tmp/api.py" "$API_PORTA" & API_PID=$!

docker run -d --name vv-caddy-teste --network host \
  -e VV_SITE="http://:$PORTA" -e VV_API_UPSTREAM="127.0.0.1:$API_PORTA" -e VV_WEB_ROOT=/srv/web \
  -v "$RAIZ/infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$DIST:/srv/web:ro" "$IMAGEM" >/dev/null
subiu=0
for _ in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$PORTA/" && { subiu=1; break; }; sleep 1; done
[ "$subiu" = 1 ] || { echo "O Caddy não subiu:" >&2; docker logs vv-caddy-teste >&2; exit 1; }

falhas=0
ok()  { echo "ok:    $1"; }
nok() { echo "FALHOU: $1" >&2; falhas=$((falhas + 1)); }
base="http://127.0.0.1:$PORTA"
cab() { curl -s -D - -o /dev/null "$@" | tr -d '\r'; }                        # cabeçalhos de uma resposta
tem() { grep -iq "^$2" <<<"$1" && ok "$3" || nok "$3 (faltou: $2)"; }        # tem(cab, regex, descrição)
nao() { grep -iq "^$2" <<<"$1" && nok "$3 (apareceu: $2)" || ok "$3"; }
uma() { n="$(grep -ic "^$2:" <<<"$1" || true)"; [ "$n" = 1 ] && ok "$3" || nok "$3 (ocorrências: $n)"; }  # exatamente uma
codigo() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

asset="$(ls "$DIST/assets" | grep -m1 '\.js$')"
for caminho in / /sw.js "/assets/$asset" /rota/qualquer /api/saude; do
  h="$(cab "$base$caminho")"
  tem "$h" "content-security-policy: default-src 'none'" "CSP em $caminho"
  tem "$h" "content-security-policy:.*frame-ancestors 'none'" "CSP com frame-ancestors em $caminho"
  tem "$h" "strict-transport-security: max-age=63072000; includeSubDomains" "HSTS em $caminho"
  tem "$h" "x-content-type-options: nosniff" "nosniff em $caminho"
  tem "$h" "referrer-policy: no-referrer" "Referrer-Policy em $caminho"
  tem "$h" "cross-origin-opener-policy: same-origin" "COOP em $caminho"
  tem "$h" "cross-origin-resource-policy: same-origin" "CORP em $caminho"
  tem "$h" "permissions-policy: camera=()" "Permissions-Policy em $caminho"
  tem "$h" "x-frame-options: DENY" "X-Frame-Options em $caminho"
  nao "$h" "server:" "sem cabeçalho Server em $caminho"
  uma "$h" "content-security-policy" "uma só CSP em $caminho"
  uma "$h" "x-content-type-options" "um só nosniff em $caminho"
done

# /api: a CSP fraca, o X-Powered-By e o Server da API não passam; o cabeçalho do Caddy é que vale.
h="$(cab "$base/api/qualquer")"
nao "$h" "content-security-policy: default-src \*" "a CSP fraca da API não chega ao cliente"
nao "$h" "x-powered-by:" "X-Powered-By da API é removido"

# Sem 'unsafe-inline' nem 'unsafe-eval', e o HTML do app não tem nada inline que a CSP bloquearia.
csp="$(cab "$base/" | grep -i '^content-security-policy:')"
grep -qE "unsafe-(inline|eval)" <<<"$csp" && nok "CSP sem unsafe-inline/unsafe-eval" || ok "CSP sem unsafe-inline/unsafe-eval"
if python3 - "$DIST/index.html" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
inline = [m for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.+?)</script>", html, re.S) if m.group(1).strip()]
sys.exit(1 if inline or re.search(r"<style[\s>]", html) or re.search(r'\sstyle="', html) else 0)
PY
then ok "index.html sem script, style nem atributo style inline"; else nok "index.html tem script ou estilo inline (a CSP bloquearia)"; fi

# Cache e conteúdo: o arquivo servido é MESMO o do build (e não o index.html no lugar dele).
tem "$(cab "$base/")"                     "cache-control: no-cache" "index.html revalida"
tem "$(cab "$base/sw.js")"                "cache-control: no-cache" "sw.js revalida"
tem "$(cab "$base/push.js")"              "cache-control: no-cache" "push.js revalida"
tem "$(cab "$base/manifest.webmanifest")" "cache-control: no-cache" "manifesto revalida"
tem "$(cab "$base/assets/$asset")"        "cache-control: public, max-age=31536000, immutable" "assets com hash em cache longo"
for arq in sw.js push.js manifest.webmanifest; do
  curl -s "$base/$arq" | cmp -s - "$DIST/$arq" && ok "$arq servido é o do build" || nok "$arq servido não é o do build"
done
tem "$(cab "$base/sw.js")"                "content-type: .*javascript" "sw.js com tipo JavaScript"
tem "$(cab "$base/push.js")"              "content-type: .*javascript" "push.js com tipo JavaScript"
tem "$(cab "$base/manifest.webmanifest")" "content-type: application/manifest\+json|content-type: application/json" "manifesto com tipo JSON"

# Rotas
[ "$(codigo "$base/rota/qualquer")" = 200 ] && ok "fallback do app em rota desconhecida" || nok "fallback do app"
[ "$(codigo "$base/assets/nao-existe.js")" = 404 ] && ok "asset inexistente é 404 (não vira index.html)" || nok "asset inexistente deve ser 404"
nao "$(cab "$base/assets/nao-existe.js")" "cache-control:.*immutable" "404 de asset não fica um ano em cache"
[ "$(codigo "$base/qualquer.php")" = 404 ] && ok "arquivo inexistente com extensão é 404 (não vira o app)" || nok "arquivo inexistente deve ser 404"
[ "$(codigo "$base/.env")" = 404 ] && ok "dotfile é 404" || nok "dotfile deve ser 404"
[ "$(codigo "$base/.git/config")" = 404 ] && ok ".git é 404" || nok ".git deve ser 404"
[ "$(codigo "$base/.well-known/qualquer")" = 404 ] && ok ".well-known não cai no app" || nok ".well-known deve ser 404"
r="$(curl -s "$base/api")"; python3 -c "import json,sys; json.loads(sys.argv[1])" "$r" 2>/dev/null && ok "/api (sem barra) vai para a API, não para o app" || nok "/api sem barra caiu no app"

# /api: prefixo removido; X-Forwarded-* escritos pelo Caddy; Origin e Sec-Fetch-Site preservados;
# no-store da API intacto e preenchido quando a API esquece
resp="$(curl -s -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 6.6.6.6' -H 'X-Forwarded-Host: evil.example' -H 'X-Forwarded-Proto: https' \
  -H 'Forwarded: for=6.6.6.6' -H 'Origin: http://127.0.0.1:18080' -H 'Sec-Fetch-Site: same-origin' "$base/api/auth/sessao?x=1")"
py() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print($1)" "$resp"; }
[ "$(py 'd["path"]')" = "/auth/sessao?x=1" ] && ok "a API recebe o caminho sem /api" || nok "caminho na API: $(py 'd["path"]')"
[ "$(py 'd["headers"].get("x-forwarded-for")')" = "127.0.0.1" ] && ok "X-Forwarded-For forjado pelo cliente é descartado" || nok "X-Forwarded-For na API: $(py 'd["headers"].get("x-forwarded-for")')"
[ "$(py 'd["headers"].get("x-real-ip")')" = "None" ] && ok "X-Real-IP do cliente não chega na API" || nok "X-Real-IP chegou na API"
[ "$(py 'd["headers"].get("x-forwarded-host")')" != "evil.example" ] && ok "X-Forwarded-Host forjado é descartado" || nok "X-Forwarded-Host forjado chegou na API"
[ "$(py 'd["headers"].get("forwarded")')" != "for=6.6.6.6" ] && ok "Forwarded forjado é descartado" || nok "Forwarded forjado chegou na API (a API não pode usá-lo)"
[ "$(py 'd["headers"].get("sec-fetch-site")')" = "same-origin" ] && ok "Sec-Fetch-Site preservado" || nok "Sec-Fetch-Site perdido"
[ "$(py 'd["headers"].get("origin")')" = "http://127.0.0.1:18080" ] && ok "Origin preservado" || nok "Origin perdido"
tem "$(cab "$base/api/qualquer")" "cache-control: no-store" "o no-store da API não é sobrescrito"
tem "$(cab "$base/api/sem-cache")" "cache-control: no-store" "rota da API sem Cache-Control recebe no-store"
big="$(head -c 400000 /dev/zero | tr '\0' 'a')"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST --data "$big" "$base/api/x")" = 413 ] && ok "corpo acima de 256 KB é recusado na borda" || nok "corpo grande deveria dar 413"

# O log: tem de EXISTIR (controle positivo) e não pode trazer cookie, token CSRF, Authorization nem Set-Cookie
curl -s -o /dev/null -H 'Cookie: __Host-sessao=segredo-req-nao-pode-vazar' -H 'X-CSRF-Token: csrf-nao-pode-vazar' \
  -H 'Authorization: Bearer token-nao-pode-vazar' "$base/api/marca-do-log"
sleep 1
log="$(docker logs vv-caddy-teste 2>&1)"
grep -q 'marca-do-log' <<<"$log" && ok "o log de acesso existe (controle positivo)" || nok "o log de acesso não registrou a requisição"
grep -q 'nao-pode-vazar' <<<"$log" && nok "segredo (cookie, CSRF, Authorization ou Set-Cookie) apareceu no log" || ok "cookie, CSRF, Authorization e Set-Cookie fora do log"

[ "$falhas" -eq 0 ] && echo "CADDY: tudo certo" || { echo "CADDY: $falhas falha(s)" >&2; exit 1; }
