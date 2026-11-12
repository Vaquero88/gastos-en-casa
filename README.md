# Casa en común

La aplicación permite el acceso público sin PIN: cualquiera con el enlace puede consultar y modificar los datos del hogar. Para una instalación nueva, aplica las migraciones SQL en orden, incluida `20261109_public_link_access.sql`.

Aplicación familiar para registrar aportaciones e ingresos compartidos y consultar los gastos por mes, categoría y subcategoría.

## Abrir en local

Haz doble clic en `Abrir Casa en comun local.bat`. El archivo inicia un servidor local y abre la aplicación con acceso a los mismos datos compartidos de Supabase; hace falta conexión a internet. `config.js` contiene únicamente la URL y la clave pública de Supabase; nunca añadas una clave `service_role` al sitio.

## Datos y acceso

Los movimientos se guardan en Supabase. No hay inicio de sesión: cualquier persona puede consultar, crear, editar y archivar movimientos de este hogar. No se registra quién hizo cada cambio.

El repositorio contiene el código y el esquema, pero no contiene el libro de Excel ni los movimientos importados. Los saldos de apertura, miembros y datos históricos se cargan directamente en Supabase.

## Publicación

El sitio se sirve desde GitHub Pages y los datos del hogar están habilitados para acceso anónimo de lectura y escritura en Supabase.



## Instalar en Android

1. Abre https://vaquero88.github.io/gastos-en-casa/ en Chrome para Android.
2. Inicia sesión y abre el menú de Chrome (⋮); elige **Instalar aplicación** o **Añadir a pantalla de inicio**.
3. Confirma. Casa en común aparecerá como una aplicación en el móvil.

La app conserva los datos en Supabase y necesita conexión a internet para consultar y guardar movimientos. La caché local guarda la interfaz, no sustituye una copia de seguridad.
