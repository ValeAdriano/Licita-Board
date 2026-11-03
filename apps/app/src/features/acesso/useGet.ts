import { useEffect, useState } from 'react';
import { chamar } from '../../api/cliente';

interface Estado<T> {
  caminho: string | null;
  dados?: T;
  erro?: string;
}

// Leitura simples de um GET da API. `caminho` nulo = não busca. Trocar o caminho (ou chamar
// `recarregar`) busca de novo; a resposta de um caminho antigo nunca sobrescreve a do atual.
export function useGet<T>(caminho: string | null) {
  const [estado, setEstado] = useState<Estado<T>>({ caminho: null });
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    chamar<T>('GET', caminho)
      .then((dados) => vivo && setEstado({ caminho, dados }))
      .catch((e: unknown) => vivo && setEstado({ caminho, erro: e instanceof Error ? e.message : 'Erro.' }));
    return () => {
      vivo = false;
    };
  }, [caminho, rodada]);

  const atual = estado.caminho === caminho ? estado : { caminho };
  return {
    dados: atual.dados,
    erro: atual.erro ?? null,
    carregando: caminho !== null && estado.caminho !== caminho,
    recarregar: () => setRodada((n) => n + 1),
  };
}
