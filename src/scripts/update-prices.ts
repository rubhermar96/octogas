import fs from 'node:fs';

const API_URL = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";

async function updateGasData() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        // Limpiamos y transformamos los datos
        const cleanData = data.ListaEESSPrecio.map((item: any) => ({
            id: item.IDEESS,
            name: item.Rótulo,
            address: item.Dirección,
            city: item.Municipio,
            province: item.Provincia,
            // Convertimos coordenadas
            lat: parseFloat(item.Latitud.replace(',', '.')),
            lng: parseFloat(item['Longitud (WGS84)'].replace(',', '.')),
            prices: {
                sp95: parseFloat(item['Precio Gasolina 95 E5'].replace(',', '.')) || null,
                sp98: parseFloat(item['Precio Gasolina 98 E5'].replace(',', '.')) || null,
                diesel: parseFloat(item['Precio Gasoleo A'].replace(',', '.')) || null,
            },
            brand: item.Rótulo.toLowerCase(),
            schedule: item.Horario
        })).filter((g: any) => g.lat && g.lng); // Solo gasolineras con ubicación

        // Guardamos el resultado en la carpeta de datos
        fs.writeFileSync('./src/data/gasolineras.json', JSON.stringify(cleanData));
        console.log(`OCTO Data: ${cleanData.length} gasolineras actualizadas.`);
    } catch (error) {
        console.error("Error al actualizar datos:", error);
    }
}

updateGasData();