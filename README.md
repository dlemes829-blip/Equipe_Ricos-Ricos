# Gestão Equipe Amanda — v2.1

Aplicação Node.js no Render, com banco PostgreSQL no Supabase. Interface cinza escuro, login, aprovação de acessos e controle por carteira.

## Fluxo de acesso

O usuário solicita acesso com nome, usuário e senha. A senha é transformada em hash scrypt com salt independente. O desenvolvimento aprova ou recusa, atribui a carteira e define os perfis. A senha original não é mostrada na administração.

O usuário `daniel` está aprovado com os perfis Gerente e Desenvolvedor. A credencial inicial foi cadastrada diretamente no banco e não está no código.

- Gerente: dados detalhados apenas da carteira atribuída; lançamentos de avaliações, cadeiras, metas, mérito e controles.
- Supervisora: acompanhamento e edição das carteiras, notificações e pedidos de melhorias.
- Desenvolvedor: administração de usuários e perfis, bloqueios, presença recente, atividade e fila de desenvolvimento.
- PRO: sinalizador administrável, com exportação de controles; não amplia a carteira nem concede funções de supervisão ou desenvolvimento.
- Painel da equipe: todos os usuários aprovados veem somente o acompanhamento coletivo autorizado de metas, avaliações agregadas e fechamentos. O painel não libera os detalhes de mérito, clínicas ou controles das outras carteiras.

## Planilha e módulos

As 69 abas da planilha foram catalogadas em Operação, Campanhas, Financeiro, Gestão, Cadastros e Arquivo. Seis abas principais são controles integrados; as demais usam tabelas editáveis com os campos de referência da planilha.

Os 2.876 registros históricos foram importados com acesso restrito à supervisão e desenvolvimento até a confirmação do responsável. O campo `suggested_manager` conserva uma sugestão de vínculo sem conceder acesso automaticamente. Ao editar um registro histórico, a supervisão pode confirmar a carteira. Os novos registros de um gerente são vinculados à própria carteira pelo servidor.

As tabelas históricas preservam valores em cache, sem executar macros ou fórmulas arbitrárias do Excel. Os cálculos de metas, avaliações, mérito, fechamento e classificação foram implementados nos módulos próprios. O botão Solicitar melhoria mantém uma fila por aba para o desenvolvimento acrescentar regras específicas.

Fontes iniciais: 72 clínicas do relatório Admin; 73 linhas de mérito (incluindo Paraguai); metas mensais de outubro/2026 transcritas do relatório enviado em imagem. Meta CG da equipe: R$ 16.790.224,78; efetivado R$ 6.991.390,85; meta orto 1.221 e pastas 381. As datas de atualização das fontes não estavam informadas; o recebimento não é apresentado como atualização oficial.

## Segurança e arquitetura

O navegador chama apenas endpoints do próprio servidor. Credenciais Supabase, credencial de conexão e chave privada VAPID ficam no ambiente do Render. O frontend não recebe chaves de infraestrutura, hashes de senha ou tokens de sessão em JSON ou armazenamento local.

A sessão usa identificador opaco em cookie HttpOnly, Secure e SameSite=Strict, com validade de 8 horas. No banco fica somente o SHA-256 desse identificador. Bloquear um usuário revoga as sessões; trocar a senha exige a senha atual e também encerra as sessões. Há limitação de tentativas no servidor e no banco.

O servidor valida origem das requisições que alteram dados, utiliza CSP sem scripts inline e serve somente arquivos públicos explicitamente listados. Dados da planilha e mensagens são tratados como texto, sem execução de HTML ou fórmulas. A exportação CSV neutraliza prefixos de fórmulas.

A função Supabase mantém `verify_jwt=true`, exige a credencial interna e, adicionalmente, uma sessão aprovada para cada operação protegida. A própria função confere os perfis administrativos e a carteira de cada consulta/alteração, inclusive registros de abas. Não há operação genérica para consultar senhas ou criar sessões de outro usuário. Login e solicitação pendente são as únicas operações sem sessão.

RLS está habilitado em todas as tabelas, sem permissões públicas para `anon` ou `authenticated`. O acesso privilegiado existe apenas dentro da função e é limitado pelas verificações por operação. Os avisos INFO de RLS sem políticas públicas são esperados: o modelo é negar o acesso público, sem autenticação direta pelo Data API.

## Notificações

A supervisão e o desenvolvimento enviam avisos para todos os aprovados ou um destinatário. O aviso é salvo na caixa de notificações. Quem optar por ativar as notificações no dispositivo poderá receber Web Push pelo service worker, sujeito à permissão, suporte e configurações do navegador/sistema. Fazer logout remove a inscrição deste dispositivo. Usuários bloqueados são excluídos dos envios push.

A chave VAPID pública é fornecida ao navegador por exigência do protocolo; ela não é uma credencial secreta nem dá acesso aos dados. A chave privada fica no servidor.

## Variáveis do Render

- SUPABASE_EDGE_URL
- SUPABASE_ANON_KEY (verificação JWT da plataforma, somente backend)
- SUPABASE_BRIDGE_TOKEN (somente backend)
- APP_DATA_ENCRYPTION_KEY (somente backend; preservar para recuperação)
- APP_ORIGIN
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY (somente backend)
- VAPID_SUBJECT
- PORT, fornecida pelo Render

O projeto Supabase é `mfigztzmdsjxqgawqfzx`, São Paulo. O antigo PostgreSQL gratuito no Render não é utilizado. Nenhuma senha de banco precisa ser inserida no navegador.

## Desenvolvimento e verificação

`npm ci --ignore-scripts` instala as versões do lockfile. `npm test` cobre hashes, cookies, cadastro sem autopromoção, operações administrativas, sessões bloqueadas, isolamento, falsificação de proprietário, classificações, totais e ausência de credenciais nos arquivos públicos. `npm run check` verifica a sintaxe.

Também foram testados login, sessão aprovada e revogação na função real. Os arquivos `lib/access.mjs` e `supabase/functions/gestao-amanda-storage/access.mjs` devem permanecer idênticos. A definição do banco está no histórico de migrações do projeto Supabase; a função implantada está versionada em `supabase/functions/gestao-amanda-storage`.

## Criptografia adicional (v2.1)

AES-256-GCM com nonce aleatório de 96 bits, tag de 128 bits e contexto de tabela/campo protege o estado financeiro, controles, dados pessoais, verificadores scrypt, mensagens, inscrições push, pedidos e detalhes de auditoria. HKDF-SHA256 deriva chaves distintas para criptografia e índices HMAC-SHA256. Usuários e endpoints são localizados por índices cegos, sem consultar seus valores legíveis. Senhas nunca são criptografadas de forma reversível: continuam como scrypt; somente o verificador recebe a camada adicional de criptografia. Sessões continuam armazenadas como hashes.

`APP_DATA_ENCRYPTION_KEY` é uma chave independente de 32 bytes em hexadecimal, armazenada exclusivamente no ambiente privado do Render. O backend a encaminha por HTTPS à função, que verifica sua impressão digital depois de validar a credencial interna e antes de acessar dados. A função continua exigindo JWT da plataforma e autorização de sessão/perfil por operação. A chave não fica no banco, no frontend nem no Git.

O arquivo inicial `seed.enc.json` também é criptografado. A fonte local `seed.json` não faz parte da versão publicada. Os testes usam dados fictícios em `tests/fixtures/seed.json`. As versões anteriores do repositório privado e backups anteriores não são reescritos; o armazenamento do provedor já possui criptografia de disco.

IDs, datas, situação e perfis de autorização são metadados operacionais mantidos para consultas e controles de acesso; as conexões usam HTTPS e o banco permanece sem acesso público. Os dados autorizados são descriptografados no servidor para exibição: esta arquitetura não promete criptografia ponta a ponta nem oculta os resultados de quem está autorizado a vê-los no navegador.

Preserve a chave no gerenciador de segredos e no procedimento de recuperação da organização. Não a regenere em deploys. A alteração exige uma migração explícita com a chave antiga; perder a chave impede recuperar os dados. O formato é versionado para permitir evolução futura. Após a migração, leituras de conteúdo privado em texto simples falham de forma fechada; restrições do banco também impedem novas gravações sem criptografia.

A migração administrativa `encryption_migrate` exige sessão aprovada de desenvolvedor, limita-se às tabelas permitidas, retorna somente contagens e usa condições de versão ao alterar dados existentes. Não concede acesso genérico ao banco.

Os avisos Web Push usam o protocolo criptografado do navegador e não incluem o texto personalizado: mostram somente um lembrete genérico. O conteúdo completo é lido na caixa interna, após autenticação. Isso evita expor mensagens na tela bloqueada. Ao sair, os avisos exibidos e a inscrição deste dispositivo são removidos.

## Interface v2.1

Menus por assunto; rotina pessoal no painel; busca de abas com Ctrl/Cmd+K; busca por clínica mantendo o formulário; indicadores de rascunho; preservação dos demais rascunhos ao salvar uma clínica; filtros por contexto e atalhos Hoje/Ontem; menu lateral móvel; foco visível e opção de mostrar a senha.

## Chromium privado e geração de relatórios (v2.2)

O Admin possui uma Central Sisodonto com Chromium real no serviço separado `gestao-amanda-chromium`. A tela é transmitida pelo backend autenticado; cliques, teclado e navegação são encaminhados por comandos limitados. O navegador não disponibiliza CDP, WebSocket de depuração, cookies ou um endereço de controle ao cliente. O serviço recusa requisições sem sua credencial privada.

`BROWSER_AGENT_SECRET` deve ter 32 bytes aleatórios em hexadecimal, iguais nos ambientes dos dois serviços. Sua impressão SHA256 deve corresponder a `AGENT_SHA256` na função. `BROWSER_AGENT_URL` existe somente no backend principal; `APP_CALLBACK_ORIGIN` aponta para a origem HTTPS principal no serviço Chromium. A credencial do navegador é independente das credenciais do banco e só permite as operações específicas de sessão e relatórios. O worker não recebe a chave mestra de criptografia nem chaves administrativas do Supabase.

A sessão (cookies, localStorage/IndexedDB suportados e sessionStorage das origens permitidas) é persistida criptografada na tabela `amanda_browser_vault`. O perfil é restaurado após reinicializações. A senha deve ser digitada manualmente no navegador, nunca salva em passos de relatório. MFA ou confirmação de acesso continuam manuais. A sessão pode expirar conforme o Sisodonto; salvar o perfil não garante sua validade futura.

A origem do Sisodonto é informada pelo desenvolvedor na barra de endereço. Redirecionamentos de nível superior ficam limitados às origens autorizadas. Requisições a IPs privados, metadados, esquemas locais e HTTP são bloqueadas, inclusive sub-recursos. O container executa com usuário não root, sem portas de depuração públicas. Somente os endpoints de saúde são públicos.

As rotas são configuradas no Admin, com passos goto/click/fill/select/wait/download, seletores opcionais de iframe e extração de tabela, texto ou XLSX/CSV. As variáveis suportadas são {{date}}, {{monthStart}}, {{monthEnd}} e {{manager}}. As rotas começam desativadas: o domínio e os caminhos reais não foram fornecidos previamente, portanto é necessário entrar no Sisodonto e configurá-los antes de habilitar a geração. A interface comum permite apenas solicitar e acompanhar os relatórios.

Os trabalhos são registrados em `amanda_report_jobs`, processados em fila e importados no servidor. O vínculo do solicitante é imposto no backend e revisto antes da importação. Leituras do portal podem abranger outras carteiras; somente unidades da carteira autorizada são persistidas ou devolvidas ao usuário. Capturas e dados brutos do portal não fazem parte da resposta comum. A importação usa versão otimista, identifica o job para evitar duplicação e preserva os demais dados.

Enquanto o navegador estiver aberto no Admin, a fila aguarda a liberação da tela ou o fim da conexão. Use **Salvar sessão** e **Liberar para relatórios** depois de entrar. A instância gratuita pode suspender por inatividade e levar cerca de um minuto para iniciar; uma instância dedicada pode ser necessária conforme o consumo real de memória e o volume de execuções. Nenhum plano pago é habilitado por esta configuração.

As três tabelas adicionais têm RLS e nenhum grant público; seus campos payload aceitam somente envelopes criptografados. As funções de agente validam uma credencial distinta e atuam somente nessas tabelas e na importação limitada do relatório, nunca como SQL ou comandos genéricos.
