/**
 * Montagem do objeto de provisionamento no formato pedido pelo desafio.
 */

/**
 * Gera o slug da unidade: sem acento, minúsculo, separado por hífen.
 * "Clínica Vida Aracaju" -> "clinica-vida-aracaju"
 *
 * @param {string} texto nome da unidade
 * @returns {string}
 */
export function gerarSlug(texto) {
  return String(texto ?? '')
    .normalize('NFD') // separa a letra do acento...
    .replace(/[\u0300-\u036f]/g, '') // ...e descarta só o acento (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // qualquer outra coisa vira separador
    .replace(/^-+|-+$/g, ''); // sem hífen sobrando nas pontas
}

/**
 * Devolve o CEP no formato 00000-000.
 *
 * @param {string} cep CEP com ou sem hífen
 * @returns {string}
 */
export function formatarCep(cep) {
  const digitos = String(cep ?? '').replace(/\D/g, '');
  if (digitos.length !== 8) return String(cep ?? '');
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

/**
 * Junta a unidade do CSV com o endereço vindo do ViaCEP.
 *
 * Cidade, UF e CEP saem do CSV, não da resposta da API: o CSV é a lista que o
 * cliente mandou provisionar, então ele é a fonte da verdade. O ViaCEP entra
 * para completar logradouro e bairro — e para conferir a cidade (ver
 * `divergenciaDeCidade`).
 *
 * @param {{ nome: string, cidade: string, uf: string, cep: string, servicos: string[] }} unidade
 * @param {{ logradouro: string, bairro: string }} endereco
 * @returns {object} registro pronto para o provisionamento.json
 */
export function montarRegistroDeProvisionamento(unidade, endereco) {
  return {
    unidade: unidade.nome,
    endereco: {
      logradouro: endereco.logradouro,
      bairro: endereco.bairro,
      cidade: unidade.cidade,
      uf: unidade.uf,
      cep: formatarCep(unidade.cep),
    },
    servicos: unidade.servicos,
    slug: gerarSlug(unidade.nome),
  };
}

/**
 * Compara a cidade do CSV com a que o ViaCEP devolveu para aquele CEP.
 *
 * Divergência aqui quase sempre é erro de digitação no CSV — o CEP aponta para
 * outra cidade. Não é motivo para descartar a unidade, mas alguém precisa
 * olhar, então vira aviso no resumo.
 *
 * @returns {string|null} descrição da divergência, ou null se estiver tudo certo
 */
export function divergenciaDeCidade(unidade, endereco) {
  if (!endereco.cidade) return null;

  const comparavel = (valor) =>
    String(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  if (comparavel(endereco.cidade) === comparavel(unidade.cidade)) return null;

  return `CSV diz "${unidade.cidade}", mas o CEP ${formatarCep(unidade.cep)} é de "${endereco.cidade}"`;
}
