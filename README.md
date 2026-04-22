# 🎸 Afinador de Violão

> Afinador cromático profissional para violão, direto no navegador — sem instalação, sem plugins.

**🌐 Acesse agora:** [https://bpvelloso.github.io/afinador/](https://bpvelloso.github.io/afinador/)

---

## Sobre

O **Afinador de Violão** é uma Progressive Web App (PWA) desenvolvida inteiramente em HTML, CSS e JavaScript puro. Utiliza a Web Audio API para capturar o áudio do microfone em tempo real e detectar a frequência fundamental de cada corda tocada, exibindo com precisão se a nota está afinada, bemol ou sustenida.

O projeto foi pensado para ser leve, rápido e funcionar em qualquer dispositivo moderno — celular, tablet ou computador — sem depender de nenhuma biblioteca externa ou framework.

---

## Funcionalidades

- **Detecção de pitch em tempo real** usando o algoritmo YIN com CMNDF (Cumulative Mean Normalized Difference Function), padrão em afinadores profissionais
- **Suporte às 6 cordas** do violão em afinação padrão: E2 · A2 · D3 · G3 · B3 · E4
- **Medidor de cents** com agulha animada indicando desvio de −50¢ a +50¢
- **Identificação automática** da corda mais próxima da nota detectada
- **Tom de referência** para cada corda (oscilador de onda triangular)
- **Visualizador de forma de onda** com intensidade proporcional ao volume
- **PWA instalável** — funciona offline após a primeira visita
- **Pré-amplificador de ganho** e filtro passa-alta para maior sensibilidade em microfones de notebook e celular

---

## Afinação Padrão

| Corda | Nota | Frequência |
|-------|------|-----------|
| 1ª    | E4   | 329.63 Hz |
| 2ª    | B3   | 246.94 Hz |
| 3ª    | G3   | 196.00 Hz |
| 4ª    | D3   | 146.83 Hz |
| 5ª    | A2   | 110.00 Hz |
| 6ª    | E2   |  82.41 Hz |

> Referência: **A4 = 440 Hz**

---

## Como usar

1. Acesse [https://bpvelloso.github.io/afinador/](https://bpvelloso.github.io/afinador/) pelo navegador
2. Clique no botão do microfone e permita o acesso ao áudio
3. Toque uma corda do violão próximo ao microfone
4. O afinador detecta automaticamente a nota e indica se está afinada (verde), bemol (amarelo) ou sustenida (vermelho)
5. Ajuste a cravelha até a agulha centralizar e o display ficar verde

---

## Tecnologias

- **HTML5 / CSS3 / JavaScript** — sem frameworks ou dependências
- **Web Audio API** — captura e processamento de áudio em tempo real
- **Algoritmo YIN** — detecção de pitch com interpolação parabólica sub-sample
- **Service Worker** — cache offline e suporte a PWA
- **Web App Manifest** — instalação na tela inicial de dispositivos móveis

---

## Instalação como App

Por ser uma PWA, o afinador pode ser instalado diretamente na tela inicial do seu celular ou como aplicativo no desktop:

- **Android (Chrome):** toque no banner "Instalar como app" ou acesse o menu do navegador → *Adicionar à tela inicial*
- **iOS (Safari):** toque em *Compartilhar* → *Adicionar à Tela de Início*
- **Desktop (Chrome/Edge):** clique no ícone de instalação na barra de endereços

---

## Executando localmente

```bash
# Clone o repositório
git clone https://github.com/bpvelloso/afinador.git
cd afinador

# Sirva com qualquer servidor HTTP (necessário para Service Worker e microfone)
npx serve .
# ou
python3 -m http.server 8080
```

Acesse `http://localhost:8080` no navegador.

> **Nota:** o acesso ao microfone exige `https://` ou `localhost`. Não funciona em `file://`.

---

## Licença

MIT © [bpvelloso](https://github.com/bpvelloso)
