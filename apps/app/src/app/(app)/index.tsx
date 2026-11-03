import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { chamar } from '../../api/cliente';
import { mensagemSair, useSessao } from '../../auth/sessao';
import { Botao, Mensagem, Tela } from '../../ui/formulario';

// Início provisório: o shell (menu, seletor de empresa, notificações, conta) chega no PR 7.
export default function Inicio() {
  const { sair } = useSessao();
  const [nome, setNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void chamar<{ usuario?: { nome?: string } }>('GET', '/me')
      .then((r) => {
        if (vivo) setNome(r.usuario?.nome ?? null);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <Tela titulo={nome ? `Olá, ${nome}` : 'VV Licitações'}>
      <Text style={{ fontWeight: '600', color: '#92400E' }}>EM DESENVOLVIMENTO: menu, empresas e notificações chegam na próxima entrega.</Text>
      <Mensagem texto={erro} />
      <Botao texto="Sair" onPress={() => void sair().catch((e: unknown) => setErro(mensagemSair(e)))} />
    </Tela>
  );
}
