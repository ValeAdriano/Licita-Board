# Glossário de licitações para agentes

Termos que aparecem no Prompt Mestre e no código. Quando a definição jurídica importar para uma regra, **não use este glossário como fonte legal**: a regra vem de `pub.regras_prazo` / `pub.base_juridica`, validadas pelo jurídico VV.

## Atores e documentos

| Termo | Significado no sistema |
| --- | --- |
| **Órgão / contratante** | Ente público que compra (prefeitura, secretaria, autarquia, hospital, consórcio...). Tabela `pub.orgaos`. |
| **UASG** | Código da unidade compradora no Compras.gov.br. |
| **Edital** | Ato que convoca a licitação e fixa regras. `pub.editais`. Pode ter retificações (`pub.edital_versoes`). |
| **TR (Termo de Referência)** | Anexo com a especificação técnica do objeto. Requisitos técnicos muitas vezes só aparecem aqui. |
| **ETP (Estudo Técnico Preliminar)** | Documento de planejamento que justifica a compra. |
| **Item / lote** | Unidade de disputa. Lote agrupa itens. **Cada item/lote vira um registro próprio** (`pub.edital_itens`); um edital com 8 itens = 8 registros. |
| **Processo** | Número administrativo do órgão para a compra. |
| **PNCP** | Portal Nacional de Contratações Públicas. Publicação obrigatória pela Lei 14.133. Primeira fonte de captura. "Número de controle PNCP" é o identificador oficial. |
| **Portal de disputa** | Onde a sessão acontece (Compras.gov.br, BLL, BNC, Licitanet...). O sistema **nunca** age no portal. |

## Modalidades e regimes

| Termo | Significado |
| --- | --- |
| **Pregão** | Modalidade mais comum para bens e serviços comuns; disputa por lances. |
| **Concorrência** | Modalidade para obras, serviços especiais, bens/serviços não comuns. |
| **Dispensa / inexigibilidade** | Contratação direta (sem disputa ou com disputa simplificada). |
| **SRP / Ata de registro de preços** | Registro de preços para compras futuras; gera ata, não contrato imediato. |
| **ME/EPP** | Microempresa / Empresa de Pequeno Porte (LC 123/2006). Têm benefícios: itens exclusivos, cota reservada, empate ficto, regularização fiscal tardia. Enquadramento tem **data de referência**. |
| **Item exclusivo ME/EPP / cota reservada / ampla concorrência** | Marcações por item que definem quem pode disputar. |
| **Empate ficto** | ME/EPP com proposta até 5% (pregão) ou 10% (demais) acima da melhor pode cobrir a oferta (LC 123, art. 44). |

## Fases da disputa

| Termo | Significado |
| --- | --- |
| **Abertura / sessão** | Data e hora da disputa. Referência para prazos de esclarecimento e impugnação. |
| **Arrematação** | Ficar em 1º lugar na fase de lances. **Não é** vitória final. |
| **Habilitação** | Conferência dos documentos da arrematante (jurídica, fiscal, econômico-financeira, técnica). |
| **Inabilitação / desclassificação** | Empresa excluída por documento (inabilitação) ou por proposta (desclassificação). |
| **Adjudicação** | Ato que atribui o objeto à vencedora. |
| **Homologação** | Ato que ratifica todo o procedimento. Só depois vem contrato/ata. |
| **Fracassada / deserta / revogada / anulada** | Sem proposta válida / sem interessados / desfeita por conveniência / desfeita por ilegalidade. |
| **Empenho / ordem de fornecimento** | Reserva orçamentária e pedido efetivo de entrega dentro de um contrato/ata. |

## Peças jurídicas

| Termo | Significado |
| --- | --- |
| **Pedido de esclarecimento** | Pergunta formal ao órgão sobre ambiguidade/omissão do edital. |
| **Impugnação** | Contestação de cláusula ilegal ou restritiva do edital, antes da abertura. |
| **Intenção de recurso** | Manifestação imediata na sessão; se não feita, preclui o direito. |
| **Razões de recurso** | Peça que fundamenta o recurso, em prazo após a intenção. |
| **Contrarrazões** | Resposta ao recurso de outro licitante. |
| **Preclusão** | Perda do direito por não agir no prazo. Por isso prazos são críticos. |
| **Tempestividade** | Estar dentro do prazo. Peça intempestiva não é sugerida como tal. |
| **Acórdão / súmula** | Decisões de tribunais de contas (TCU, TCE-PR, TCE-SC). Só citáveis se estiverem em `pub.base_juridica`. |

## Documentos da empresa

| Termo | Significado |
| --- | --- |
| **Certidão / CND** | Prova de regularidade (Federal, Estadual, Municipal, FGTS, CNDT). Tem validade; vencimento gera alerta. |
| **Atestado de capacidade técnica** | Prova de fornecimento anterior, com quantidades e características estruturadas. |
| **Procuração / signatário** | Quem assina pela empresa. Bloquear signatário com poderes vencidos na data do documento. |
| **Papel timbrado** | Modelo Word da empresa usado na geração de documentos. |

## Classificações da análise técnica (Fase 06)

| Termo | Regra |
| --- | --- |
| **ATENDE** | Exige citação literal do edital **e** da ficha técnica, conferida no arquivo. Comparação numérica feita por código. |
| **ATENDE COM RESSALVAS** | Atende com observação registrada. |
| **A CONFIRMAR** | Sem evidência, citação não localizada ou saída inválida da IA. Padrão seguro. |
| **NÃO ATENDE** | Requisito descumprido. Obrigatório não atendido impede ATENDE integral do produto. |

## Termos internos

| Termo | Significado |
| --- | --- |
| **Participação** | Empresa x item (`priv.participacoes`). Concentra status, responsável e situações. |
| **Data interna recomendada** | Prazo interno antes do legal (padrão: 2 dias úteis antes). |
| **Step-up** | Reautenticação MFA para operação crítica; gera token de 5 min. |
| **BYOK** | "Bring your own key": empresa usa a própria chave de IA, guardada no Vault. |
| **A x B** | Teste de isolamento: usuário da empresa A tenta ler/editar/apagar/baixar dado da empresa B. |
