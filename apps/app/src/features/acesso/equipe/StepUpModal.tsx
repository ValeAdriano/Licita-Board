import { useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { ErroApi } from '../../../api/cliente';
import { useSessao, type EscopoStepUp } from '../../../auth/sessao';
import { Botao, Campo, Mensagem } from '../../../ui/formulario';

// Confirmação de operação crítica (spec §6 regra 10): código NOVO do autenticador, que vira uma
// credencial de uso único (5 min) para o escopo. O app só repassa; quem confere é a API/banco.
// Cada código errado ou repetido conta como erro de MFA (5 encerram a sessão): por isso um envio
// por vez, o mesmo código nunca é reenviado e "Cancelar" vale também para o envio em andamento.
export function StepUpModal(props: {
  aberto: boolean;
  escopo: EscopoStepUp;
  descricao: string;
  resumo: string[];
  aoConfirmar: (stepUp: string) => Promise<void>;
  aoCancelar: () => void;
}) {
  const { aberto, escopo, descricao, resumo, aoConfirmar, aoCancelar } = props;
  const { stepUp } = useSessao();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const emVoo = useRef(false);
  const geracao = useRef(0);
  const ultimoUsado = useRef<string | null>(null);

  async function confirmar() {
    if (emVoo.current) return;
    const c = codigo.trim();
    if (!/^\d{6}$/.test(c)) return setErro('Informe o código de 6 dígitos do autenticador.');
    if (c === ultimoUsado.current) return setErro('Esse código já foi usado. Aguarde o próximo código do autenticador.');
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    const minha = geracao.current;
    try {
      ultimoUsado.current = c;
      const id = await stepUp(escopo, c);
      setCodigo('');
      // Cancelou enquanto o código era conferido: a operação crítica não segue.
      if (minha === geracao.current) await aoConfirmar(id);
    } catch (e) {
      if (minha !== geracao.current) return;
      if (e instanceof ErroApi && e.status === 403) {
        setErro('Não foi possível autorizar agora. Confira se o autenticador está ativo há mais de 24 horas e tente de novo.');
      } else {
        setErro(e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.');
      }
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  function cancelar() {
    geracao.current += 1;
    setCodigo('');
    setErro(null);
    aoCancelar();
  }

  return (
    <Modal transparent visible={aberto} animationType="fade" onRequestClose={cancelar}>
      <View style={estilos.fundo}>
        <View style={estilos.caixa} role="dialog" aria-modal>
          <Text accessibilityRole="header" style={estilos.titulo}>
            Confirmar operação crítica
          </Text>
          <Text>{descricao}</Text>
          <View style={estilos.resumo}>
            {resumo.map((linha) => (
              <Text key={linha} style={estilos.linha}>
                {linha}
              </Text>
            ))}
          </View>
          <Campo
            rotulo="Código do autenticador"
            value={codigo}
            onChangeText={setCodigo}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            onSubmitEditing={() => void confirmar()}
          />
          <Mensagem texto={erro} />
          <Botao texto="Confirmar" onPress={() => void confirmar()} carregando={enviando} />
          <Botao secundario texto="Cancelar" onPress={cancelar} />
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'center', padding: 16 },
  caixa: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, gap: 12, maxWidth: 400, width: '100%', alignSelf: 'center' },
  titulo: { fontSize: 18, fontWeight: '700' },
  resumo: { gap: 2, padding: 8, borderRadius: 8, backgroundColor: '#F1F5F9' },
  linha: { fontSize: 14, fontWeight: '600' },
});
