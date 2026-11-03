import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { chamar, ErroApi } from '../../api/cliente';
import { useAcesso, type Vinculo } from '../../features/acesso/contexto';
import { ConvidarUsuario } from '../../features/acesso/equipe/ConvidarUsuario';
import { EditorVinculo } from '../../features/acesso/equipe/EditorVinculo';
import { convitePendente, type ConviteEmpresa, type Membro } from '../../features/acesso/equipe/tipos';
import { rotuloPapel, type Modulo } from '../../features/acesso/matriz';
import { useGet } from '../../features/acesso/useGet';
import { Botao, Mensagem } from '../../ui/formulario';

// Equipe e permissões da empresa selecionada (Prompt 1.3). O app só lê e chama a API; quem decide o
// que cada um vê e faz é o banco. Trocar de empresa remonta a tela: nada em edição vai para a errada.
export default function Equipe() {
  const { empresa } = useAcesso();
  if (!empresa) return <Aviso texto="Selecione uma empresa." />;
  return <EquipeDaEmpresa key={empresa.empresaId} empresa={empresa} />;
}

function Aviso({ texto }: { texto: string }) {
  return (
    <View style={estilos.tela}>
      <Text>{texto}</Text>
    </View>
  );
}

function EquipeDaEmpresa({ empresa }: { empresa: Vinculo }) {
  const { pode } = useAcesso();
  const podeVer = pode('usuarios', 'visualizar');
  const podeVerPermissoes = pode('permissoes', 'visualizar');
  // Editar a matriz exige ver as permissões (senão a tela mostraria tudo vazio e salvaria por cima).
  const podeAdministrar = pode('permissoes', 'administrar_permissoes') && podeVerPermissoes;
  const usuarios = useGet<Membro[]>(podeVer ? `/empresas/${empresa.empresaId}/usuarios` : null);
  const convites = useGet<ConviteEmpresa[]>(podeVerPermissoes ? `/empresas/${empresa.empresaId}/convites` : null);
  const modulos = useGet<Modulo[]>('/modulos');
  const [editando, setEditando] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!podeVer) return <Aviso texto={`Você não tem permissão para ver os usuários de ${empresa.empresa}.`} />;

  const membro = usuarios.dados?.find((m) => m.vinculoId === editando);

  async function revogar(id: string) {
    setErro(null);
    try {
      await chamar('DELETE', `/convites/${id}`);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível revogar o convite.');
    }
    convites.recarregar();
  }

  return (
    <ScrollView contentContainerStyle={estilos.tela}>
      <Text accessibilityRole="header" style={estilos.titulo}>
        Equipe e permissões
      </Text>
      <Text style={estilos.sub}>{empresa.empresa}</Text>
      <Mensagem texto={erro ?? usuarios.erro ?? convites.erro ?? modulos.erro} />

      {membro && modulos.dados ? (
        <EditorVinculo
          key={membro.vinculoId}
          membro={membro}
          modulos={modulos.dados}
          podeAdministrar={podeAdministrar}
          aoSalvar={usuarios.recarregar}
          aoFechar={() => setEditando(null)}
        />
      ) : convidando && modulos.dados ? (
        <ConvidarUsuario
          empresaId={empresa.empresaId}
          modulos={modulos.dados}
          aoConcluir={() => {
            setConvidando(false);
            convites.recarregar();
          }}
          aoCancelar={() => setConvidando(false)}
        />
      ) : (
        <>
          {podeAdministrar ? <Botao texto="Convidar usuário" onPress={() => setConvidando(true)} /> : null}
          {usuarios.carregando ? <Text>Carregando…</Text> : null}
          {usuarios.dados?.map((m) => (
            <Botao
              key={m.vinculoId}
              secundario
              texto={`${m.nome || m.email} · ${rotuloPapel(m.papel)}${m.ativo ? '' : ' · inativo'}`}
              onPress={() => setEditando(m.vinculoId)}
            />
          ))}
          {podeVerPermissoes ? (
            <>
              <Text accessibilityRole="header" style={estilos.secao}>
                Convites pendentes
              </Text>
              {convites.dados?.filter((c) => convitePendente(c)).length === 0 ? <Text style={estilos.sub}>Nenhum convite pendente.</Text> : null}
              {convites.dados
                ?.filter((c) => convitePendente(c))
                .map((c) => (
                  <View key={c.id} style={estilos.convite}>
                    <Text style={estilos.nome}>{c.email}</Text>
                    <Text style={estilos.sub}>
                      {rotuloPapel(c.papel)} · expira em {new Date(c.expiraEm).toLocaleDateString('pt-BR')}
                    </Text>
                    {podeAdministrar ? <Botao secundario texto="Revogar convite" onPress={() => void revogar(c.id)} /> : null}
                  </View>
                ))}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  tela: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  titulo: { fontSize: 24, fontWeight: '700' },
  sub: { color: '#475569' },
  secao: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  convite: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, gap: 4 },
  nome: { fontWeight: '600' },
});
