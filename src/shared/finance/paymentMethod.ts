export const paymentMethods = { pix:'Pix', debit_card:'Cartão de débito', credit_card:'Cartão de crédito', cash:'Dinheiro', boleto:'Boleto', bank_transfer:'Transferência bancária', other:'Outro' } as const
export type PaymentMethod = keyof typeof paymentMethods
export function paymentNote(method?: PaymentMethod): string | undefined { return method ? `Forma de pagamento: ${paymentMethods[method]}` : undefined }
