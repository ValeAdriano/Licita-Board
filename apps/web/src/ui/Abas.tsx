import { TabList, Tabs } from '@/components/application/tabs/tabs'

export interface ItemAba {
  id: string
  rotulo: string
}

// Abas do Untitled UI (sublinhadas, rolam na horizontal no celular). O conteúdo de cada aba fica a cargo da
// página: ela renderiza o que corresponde à aba ativa.
export function Abas<T extends string>({ abas, ativa, aoMudar, rotulo }: { abas: { id: T; rotulo: string }[]; ativa: T; aoMudar: (id: T) => void; rotulo: string }) {
  return (
    <Tabs selectedKey={ativa} onSelectionChange={(k) => aoMudar(String(k) as T)}>
      <TabList type="underline" size="md" aria-label={rotulo} items={abas.map((a) => ({ id: a.id, label: a.rotulo }))} className="max-w-full overflow-x-auto scrollbar-hide" />
    </Tabs>
  )
}
