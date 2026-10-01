<p align="center">
  <img src="docs/img/portada.png" alt="Atlas Signal — cifrado y esteganografía en el navegador, por el Lic. Germán Cárdenas" width="100%">
</p>

<p align="center">
  <a href="https://licgermancardenas-crypto.github.io/ATLAS-SIGNAL/"><b>🌐 Abrir Atlas Signal</b></a>
  &nbsp;·&nbsp;
  <a href="#capturas">Capturas</a>
  &nbsp;·&nbsp;
  <a href="#cómo-usarlo">Cómo usarlo</a>
  &nbsp;·&nbsp;
  <a href="#cómo-funciona">Cómo funciona</a>
</p>

---

## ¿Qué es?

**Atlas Signal** esconde un secreto a plena vista. Tomas una imagen o un audio cualquiera, eliges un archivo o escribes un mensaje, pones una contraseña, y obtienes un archivo que se ve y suena igual que el original, pero que lleva tu secreto cifrado en su interior.

Como el titán Atlas sostiene el mundo, Atlas Signal sostiene tu información dentro de la señal de una imagen o de un audio: **invisible para el ojo y el oído, ilegible sin tu contraseña.**

## Características

- 🔐 **Cifrado AES-256-GCM** con clave derivada de tu contraseña mediante PBKDF2-SHA256 (600.000 iteraciones). Cualquier alteración del contenido se detecta.
- 🎲 **Dispersión con clave**: los bits se reparten en posiciones pseudoaleatorias que solo tu contraseña conoce. No hay cabeceras ni firmas reconocibles.
- 🖼️ **Imágenes**: PNG, BMP, JPG, WEBP y GIF como portador; el resultado se guarda como PNG sin pérdida. Respeta las transparencias.
- 🎧 **Audio**: WAV PCM de 8, 16, 24 o 32 bits y WAV en coma flotante.
- 📝 **Mensajes o archivos** de cualquier tipo; el nombre del archivo viaja **dentro** del cifrado.
- 🗜️ **Compresión automática** antes de cifrar, para que quepa más contenido.
- 🕶️ **Dos modos**: *Sigiloso* (1 bit, más difícil de detectar) o *Capacidad* (2 bits, el doble de espacio).
- ✉️ **Cifrado de texto suelto**: convierte un mensaje en un bloque `AS1.…` para enviarlo por cualquier medio.
- 🏠 **100% local**: nada se sube a internet. Funciona sin conexión y no necesita instalación.
- 📜 **Historial opcional** guardado solo en tu navegador, sin contraseñas ni contenido.

## Capturas

<table>
  <tr>
    <td width="50%"><img src="docs/img/ocultar.png" alt="Ocultar: portador, contenido y contraseña"><p align="center"><b>Ocultar</b>: elige el portador, el contenido y la contraseña</p></td>
    <td width="50%"><img src="docs/img/resultado.png" alt="Resultado de la ocultación"><p align="center"><b>Resultado</b>: descarga el archivo con el secreto</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/img/extraer.png" alt="Extraer un mensaje oculto"><p align="center"><b>Extraer</b>: recupera el mensaje con la contraseña</p></td>
    <td width="50%"><img src="docs/img/texto.png" alt="Cifrar texto sin portador"><p align="center"><b>Cifrar texto</b>: mensajes cifrados para enviar por cualquier medio</p></td>
  </tr>
</table>

<p align="center">
  <img src="docs/img/movil.png" alt="Atlas Signal en el móvil: ocultar" width="260">
  &nbsp;&nbsp;
  <img src="docs/img/movil-extraer.png" alt="Atlas Signal en el móvil: extraer" width="260">
  <br><sub>Diseño adaptado a móviles</sub>
</p>

## Cómo usarlo

### Opción 1: abrir directamente
1. Descarga el repositorio (**Code → Download ZIP**) y descomprímelo.
2. Abre `index.html` con Chrome, Edge o Firefox.

### Opción 2: en línea
Publícalo gratis con GitHub Pages (**Settings → Pages → Deploy from branch → main**) y ábrelo desde cualquier equipo. Aunque esté en internet, todo el procesamiento ocurre en el navegador de quien lo usa.

### Ocultar
1. **Portador**: arrastra una imagen o un audio WAV.
2. **Contenido**: elige un archivo o escribe un mensaje.
3. **Protección**: escribe una contraseña (o genera una con 🎲) y confírmala.
4. Pulsa **Ocultar** y descarga el resultado.

### Extraer
1. Carga el PNG o WAV generado por Atlas Signal.
2. Introduce la contraseña y pulsa **Extraer**.

## Cómo funciona

```
contenido ──► empaquetado + compresión ──► AES-256-GCM (clave = PBKDF2(contraseña, sal))
                                                  │
                                                  ▼
          sal │ iv │ longitud enmascarada │ datos cifrados
                                                  │
                    permutación con clave (red de Feistel)
                                                  ▼
            bits menos significativos del portador, en posiciones dispersas
```

- **Imágenes**: se modifican los bits menos significativos de los canales rojo, verde y azul de los píxeles opacos. Un cambio de ±1 en un valor de 0 a 255 es imperceptible.
- **Audio**: se modifica el bit menos significativo de cada muestra, muy por debajo del nivel audible en audio de 16 o 24 bits.
- **Capacidad aproximada** en modo Sigiloso: ancho × alto × 3 ÷ 8 bytes para imágenes (una foto Full HD admite unos 760 KB) y número de muestras ÷ 8 para audio (un minuto en estéreo a 44,1 kHz admite unos 660 KB).

## Buenas prácticas

- Usa contraseñas largas y compártelas **por otro canal**, nunca junto al archivo.
- Envía el archivo resultante **como documento** o dentro de un ZIP. WhatsApp, Telegram, Instagram y similares recomprimen imágenes y audios, y eso destruye el contenido oculto.
- Prefiere portadores con textura (fotografías, audio continuo) antes que fondos planos o silencios.
- No edites, recortes ni conviertas el archivo resultante.

## Desarrollo

Sin dependencias ni compilación: HTML, CSS y JavaScript puro.

```
index.html            interfaz
css/styles.css        estilo "Titán"
js/app.js             lógica de la interfaz
js/core/crypto.js     cifrado, empaquetado y contraseñas
js/core/stego.js      motor de esteganografía
js/core/carriers.js   lectura y escritura de imágenes y WAV
js/vendor/            UPNG.js y pako (ver THIRD_PARTY_NOTICES.md)
tests/run-tests.js    pruebas del núcleo
```

Pruebas (requiere Node.js 20 o superior):

```bash
node tests/run-tests.js
```

## Uso responsable

Atlas Signal es una herramienta de privacidad y aprendizaje. Úsala respetando las leyes aplicables. El autor no se hace responsable del uso que se haga del software.

## Licencia

© 2026 **Germán Cárdenas**. Distribuido bajo la [licencia MIT](LICENSE).
Las librerías incluidas en `js/vendor/` conservan sus propias licencias: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
