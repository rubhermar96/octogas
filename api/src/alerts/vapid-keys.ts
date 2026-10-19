/**
 * Crea las claves VAPID de los avisos (identifican a OCTO ante los servicios de push
 * de los navegadores) en el .env de la API, solo si faltan. No las muestra: la privada
 * no debe salir del servidor. Lo ejecutan deploy/setup.sh y deploy/update.sh.
 *
 *     npm run vapid-keys
 *
 * Cambiarlas invalida las suscripciones existentes (habría que volver a activar los avisos).
 */
import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";

const file = path.resolve(process.argv[2] ?? ".env");
const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
if (/^VAPID_PUBLIC_KEY=\S+/m.test(text) && /^VAPID_PRIVATE_KEY=\S+/m.test(text)) {
    console.log("Claves VAPID: ya existen.");
} else {
    const { publicKey, privateKey } = webpush.generateVAPIDKeys();
    const sep = text && !text.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(file, `${sep}VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=mailto:contactaocto@gmail.com\n`);
    console.log(`Claves VAPID creadas en ${file}.`);
}
