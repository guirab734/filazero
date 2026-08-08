# Parte 2 — Comunicação de suporte

Chamado recebido no plantão:

> **Assunto:** URGENTE painel não funciona
>
> "Bom dia, o painel de senhas da recepção parou de atualizar desde ontem, os
> pacientes estão reclamando que o número não muda. Já reiniciei o computador e
> nada. Preciso de solução AGORA pois a clínica está cheia."

---

## 1. Resposta ao cliente

**Assunto:** Re: URGENTE painel não funciona — já estamos atuando

Bom dia!

Recebi seu chamado e já estou olhando o caso agora. Entendo a urgência: com a
recepção cheia e o painel parado, a fila trava e a pressão sobra toda para a
sua equipe. Vamos resolver isso.

**Primeiro, para a clínica não parar enquanto investigo:** a chamada das senhas
continua funcionando normalmente pelo sistema, é só a exibição no painel que
está travada. Duas saídas imediatas:

1. Abra o painel em outro dispositivo — outro computador, um notebook ou até um
   celular/tablet ligado na TV. Se ele voltar a atualizar, a recepção segue
   atendendo por ali enquanto eu trato o equipamento original.
2. No computador da recepção, feche o navegador por completo e abra o endereço
   do painel de novo (reiniciar o Windows não recarrega necessariamente a
   página, e é comum a conexão do painel cair sem que a tela mude).

**Para eu achar a causa, preciso de três informações rápidas:**

1. O aplicativo dos pacientes e o painel do atendente estão atualizando
   normalmente, ou também estão parados?
2. Abrindo o painel em outro aparelho, ele atualiza?
3. O número que aparece na tela está congelado no mesmo desde ontem, e você
   lembra mais ou menos do horário em que parou?

Pode me responder por aqui ou me chamar no telefone **[telefone do plantão]**,
o que for mais rápido para você — se preferir, eu ligo agora.

Assim que você me passar isso eu retorno com o diagnóstico. Independente da sua
resposta, **eu te dou uma posição em até 30 minutos**, mesmo que seja para dizer
que ainda estou investigando.

Abraço,
[Nome] — Suporte Filazero

---

## 2. Três verificações técnicas

**1. O problema é só no painel, ou o app dos pacientes e o painel do atendente
também pararam?**

Separa um problema local (aquele equipamento/rede/navegador) de um problema na
plataforma. Se só o painel da recepção parou, a investigação fica no
dispositivo; se tudo parou, é backend e a prioridade muda na hora — deixa de ser
um cliente afetado e passa a ser potencialmente todos.

**2. O painel aberto em outro dispositivo, e de preferência em outra rede (o
celular no 4G), atualiza?**

Isola em uma tacada só três suspeitos: sessão expirada, cache do navegador e a
rede da clínica (firewall ou proxy bloqueando a conexão em tempo real que o
painel mantém aberta). Se funciona no 4G e não no Wi-Fi da clínica, o problema
é a rede local, não a Filazero — e o cliente já disse que reiniciou o
computador, então esse teste é o que mais informação entrega pelo menor esforço
dele.

**3. As senhas estão de fato sendo chamadas no sistema, e desde que horas o
número está congelado?**

Distingue "o painel não atualiza" de "ninguém está chamando a próxima senha" —
que acontece mais do que parece, principalmente com atendente novo ou fila
configurada em outro guichê. O horário exato serve para cruzar com deploys,
janelas de manutenção e logs do dia anterior: se a parada coincide com uma
publicação nossa, o caminho de investigação já começa apontado.

---

## 3. Quando e como eu escalaria para o desenvolvimento

**Quando escalar:**

- Assim que as verificações indicarem que o problema **não é local** — o painel
  falha em outro dispositivo e em outra rede, ou a senha avança no sistema mas
  não na tela. Aí a causa está do nosso lado e o suporte não resolve sozinho.
- Se houver **qualquer sinal de que passa de um cliente** (outros chamados
  parecidos no mesmo período). Nesse caso escalo imediatamente, mesmo sem ter
  terminado o diagnóstico — a suspeita de incidente coletivo vale mais que a
  investigação completa de um caso.
- Se em **30 minutos** eu não tiver uma causa provável, com a clínica cheia.
  Segurar o chamado por orgulho de resolver sozinho só aumenta o prejuízo do
  cliente.

**Como escalar:**

Abro o chamado no canal de plantão do time (não em mensagem privada, para ficar
registrado e qualquer pessoa de plantão poder pegar), com severidade alta e o
contexto já mastigado:

- cliente, unidade e identificador da fila/painel;
- horário exato em que parou e quando foi reportado;
- alcance: um dispositivo, a unidade inteira ou vários clientes;
- o que já testei e qual foi o resultado de cada teste (para ninguém repetir
  trabalho);
- evidências: print da tela, erros do console do navegador, e se o número
  congelou ou zerou;
- impacto em uma linha: "clínica cheia, N pacientes esperando, sem chamada de
  senha desde X".

Depois de escalar, eu **continuo dono do chamado**: acompanho a investigação e
mantenho o cliente informado a cada 30 minutos, mesmo sem novidade — silêncio
durante uma parada é o que mais desgasta a relação. E quando resolver, volto ao
cliente explicando o que aconteceu e o que evita a repetição.
