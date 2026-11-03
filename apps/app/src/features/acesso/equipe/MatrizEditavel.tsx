import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ACOES, acaoPermitida, alternar, chave, type Modulo, type Papel } from '../matriz';

// Matriz módulo × 12 ações. Cada módulo é um cartão com as ações como caixas de marcar (360 px
// primeiro). CLIENTE só recebe "Visualizar" (o banco também barra); desmarcado = sem acesso.
export function MatrizEditavel(props: {
  modulos: Modulo[];
  papel: Papel;
  selecao: Set<string>;
  aoMudar: (s: Set<string>) => void;
  somenteLeitura: boolean;
  // Quem concede não dá mais do que tem (teto, conferido no banco): o que o autor não tem fica
  // travado quando desmarcado. Só ajuda a tela; a decisão é da API.
  podeConceder?: (modulo: string, acao: string) => boolean;
}) {
  const { modulos, papel, selecao, aoMudar, somenteLeitura, podeConceder } = props;
  return (
    <View style={estilos.lista}>
      {modulos.map((m) => (
        <View key={m.slug} style={estilos.cartao}>
          <Text accessibilityRole="header" style={estilos.modulo}>
            {m.nome}
          </Text>
          <View style={estilos.acoes}>
            {ACOES.map((a) => {
              const marcada = selecao.has(chave(m.slug, a.id));
              const alemDoTeto = !marcada && podeConceder !== undefined && !podeConceder(m.slug, a.id);
              const bloqueada = somenteLeitura || !acaoPermitida(papel, a.id) || alemDoTeto;
              return (
                <Pressable
                  key={a.id}
                  role="checkbox"
                  aria-checked={marcada}
                  aria-disabled={bloqueada}
                  aria-label={`${m.nome}: ${a.rotulo}`}
                  disabled={bloqueada}
                  onPress={() => aoMudar(alternar(selecao, m.slug, a.id))}
                  style={[estilos.chip, marcada && estilos.marcada, bloqueada && estilos.bloqueada]}
                >
                  <Text style={[estilos.texto, marcada && estilos.textoMarcado]}>
                    {marcada ? '✓ ' : ''}
                    {a.rotulo}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  lista: { gap: 8 },
  cartao: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, gap: 8 },
  modulo: { fontSize: 16, fontWeight: '700' },
  acoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: '#94A3B8', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  marcada: { backgroundColor: '#DBEAFE', borderColor: '#1D4ED8' },
  bloqueada: { opacity: 0.4 },
  texto: { fontSize: 13 },
  textoMarcado: { color: '#1E3A8A', fontWeight: '600' },
});
