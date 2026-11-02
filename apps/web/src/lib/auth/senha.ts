import { z } from 'zod'

// Espelha supabase/config.toml: mínimo 12, maiúscula, minúscula e dígito (ADR-002).
// O Supabase também bloqueia senhas vazadas em produção; a mensagem desse erro vem de mensagemDeErro().
export const senhaForte = z
  .string()
  .min(12, 'Use pelo menos 12 caracteres.')
  .regex(/[a-z]/, 'Inclua uma letra minúscula.')
  .regex(/[A-Z]/, 'Inclua uma letra maiúscula.')
  .regex(/[0-9]/, 'Inclua um número.')

export const novaSenhaSchema = z
  .object({ senha: senhaForte, confirmacao: z.string() })
  .refine((v) => v.senha === v.confirmacao, { message: 'As senhas não conferem.', path: ['confirmacao'] })

export type NovaSenha = z.infer<typeof novaSenhaSchema>
