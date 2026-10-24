# NovMox 📺

Tu propia página para ver películas, series y canales, con una interfaz pensada para la **tele** (se maneja con las flechas del control remoto), que también funciona en celular y computadora, y que puedes **compartir con tus amigos**.

No necesita servidor, base de datos ni instalar nada: son archivos HTML, CSS y JS que se publican gratis en GitHub Pages.

## Publicarla en internet (gratis)

1. Sube este repositorio a GitHub (ya está en `adieljc2003-art/NovMox`).
2. En GitHub entra a **Settings → Pages**.
3. En *Build and deployment* elige **Deploy from a branch**, selecciona la rama y la carpeta `/ (root)`, y guarda.
4. En uno o dos minutos tu página queda en `https://adieljc2003-art.github.io/NovMox/`.

Ese enlace es el que compartes con tus amigos y el que abres en la tele.

## Verla en la tele

- **Smart TV (Samsung, LG, Android TV, Fire TV, Roku con navegador):** abre el navegador de la tele y entra al enlace. Muévete con las flechas, entra con **OK** y regresa con **Atrás**.
- **Chromecast / Google TV:** abre la página en Chrome (celular o compu) y usa *Transmitir*.
- En el reproductor: **← / →** atrasan o adelantan 10 segundos y **OK** pausa o reanuda.

Consejo: el botón **Compartir** (arriba a la derecha) muestra un **código QR**, así puedes abrir la página en la tele y tus amigos la escanean desde su celular.

## Agregar películas

### Desde la página (rápido)
Entra a **Agregar** (el ícono **+** o el engrane) y llena el formulario:

| Campo | Qué poner |
| --- | --- |
| Tipo | Película, Serie, TV en vivo, Deportes o Infantil |
| Enlace del video | Enlace directo `.mp4` / `.webm`, transmisión `.m3u8` (HLS) o un video de YouTube |
| Episodios (series) | Uno por línea: `Capítulo 1 \| https://…/cap1.mp4` |
| Póster / Fondo | Enlaces a imágenes (opcional; si no hay, se genera una portada de color) |

Lo que agregas así se guarda **en ese dispositivo** (en el navegador).

### Carátulas automáticas con TMDB
1. Crea una cuenta gratis en [themoviedb.org](https://www.themoviedb.org/signup).
2. Ve a **Ajustes → API** ([themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)) y solicita una clave (uso personal). Copia la **Clave de API** (v3) o el **token de lectura** (v4); sirve cualquiera de los dos.
3. En NovMox entra a **Agregar**, pégala en **Carátulas automáticas (TMDB)** y pulsa **Guardar clave**.

Listo: al agregar una película o serie sin póster, se buscan solos el póster, el fondo, el año y la descripción en español. Si quieres elegir tú (por ejemplo, cuando hay varias con el mismo nombre), usa **Buscar carátula en TMDB** debajo del título. **Completar carátulas faltantes** se las pone a todo lo que ya tenías agregado.

La clave se guarda solo en tu dispositivo y no se sube al repositorio. Las carátulas quedan guardadas como enlaces dentro de cada película, así que tus amigos las ven sin necesitar ninguna clave.

### Para que todos tus amigos lo vean
1. En **Agregar** pulsa **Descargar catalogo.json**.
2. Reemplaza el archivo `data/catalogo.json` del repositorio por el que descargaste (en GitHub: abre el archivo → ✏️ editar, o *Add file → Upload files*).
3. Listo: cualquiera que abra tu página verá el catálogo completo.

También puedes compartir una sola película: abre su ficha → **Compartir**. El enlace lleva la ficha completa, así que tu amigo puede verla y guardarla en su catálogo aunque no la hayas subido a `catalogo.json`.

### Formato de `data/catalogo.json`

```json
[
  {
    "id": "mi-pelicula",
    "titulo": "Mi película",
    "tipo": "peliculas",
    "anio": 2024,
    "descripcion": "De qué trata.",
    "poster": "https://…/poster.jpg",
    "fondo": "https://…/fondo.jpg",
    "video": "https://…/pelicula.mp4",
    "destacado": true
  },
  {
    "id": "mi-serie",
    "titulo": "Mi serie",
    "tipo": "series",
    "episodios": [
      { "titulo": "Capítulo 1", "video": "https://…/cap1.mp4" }
    ]
  }
]
```

`tipo` puede ser `peliculas`, `series`, `envivo`, `deportes` o `infantil`. Los que tengan `"destacado": true` salen en el banner grande del inicio.

## ¿Dónde guardo mis videos?

La página solo **reproduce enlaces**: los videos tienen que estar alojados en algún lado con un enlace directo. Algunas opciones: tu propio servidor o NAS, almacenamiento en la nube que dé enlaces públicos directos (Cloudflare R2, Backblaze B2, Bunny Stream, etc.), YouTube o Internet Archive para contenido libre.

Usa solo contenido que te pertenezca o que tengas permiso de compartir. Los ejemplos que trae son películas libres de la Blender Foundation (licencia Creative Commons).

## Probar en tu computadora

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

(Abrirla con doble clic en `index.html` no carga `catalogo.json`; usa un servidor local como el de arriba.)

## Estructura

```
index.html          Estructura de la página
css/styles.css      Diseño (tema oscuro, escalado para TV y celular)
js/app.js           Lógica: catálogo, navegación con control, reproductor, compartir
data/catalogo.json  El catálogo que ven todos
```
