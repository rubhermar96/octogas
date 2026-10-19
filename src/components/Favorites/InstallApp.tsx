import React, { useEffect, useState } from 'react';
import styles from './InstallApp.module.css';
import { track } from '../../lib/track';

/** Evento "beforeinstallprompt" de Chrome/Edge (no está en los tipos de TypeScript). */
interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
    interface Window {
        __octoInstall?: InstallPromptEvent | null;
    }
}

type Mode = 'none' | 'prompt' | 'ios' | 'android' | 'installed';

/**
 * "Ten OCTO en tu móvil": botón de instalar donde el navegador lo permite (Chrome,
 * Edge, Samsung Internet; el aviso lo guarda el script de Layout.astro) y, en iPhone,
 * los pasos para añadirlo a la pantalla de inicio. No sale si ya se abre como app.
 */
const InstallApp: React.FC = () => {
    const [mode, setMode] = useState<Mode>('none');

    useEffect(() => {
        const standalone =
            matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
        if (standalone) return setMode('installed');
        const ua = navigator.userAgent;
        const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        setMode(window.__octoInstall ? 'prompt' : ios ? 'ios' : /Android/.test(ua) ? 'android' : 'none');

        const onInstallable = () => setMode('prompt');
        const onInstalled = () => {
            setMode('installed');
            track('instalar_app');
        };
        window.addEventListener('octo-installable', onInstallable);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('octo-installable', onInstallable);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    if (mode === 'none' || mode === 'installed') return null;

    const install = async () => {
        const e = window.__octoInstall;
        if (!e) return;
        await e.prompt();
        const { outcome } = await e.userChoice;
        window.__octoInstall = null;
        setMode(outcome === 'accepted' ? 'installed' : 'none');
    };

    return (
        <aside className={styles.box} aria-label="Instalar OCTO">
            <span className={`material-symbols-outlined ${styles.icon}`} aria-hidden="true">add_to_home_screen</span>
            <div className={styles.text}>
                <h2>Ten OCTO en tu móvil como una app</h2>
                {mode === 'prompt' && (
                    <>
                        <p>Con su icono en la pantalla de inicio: se abre directamente en tus gasolineras.</p>
                        <button type="button" className={styles.btn} onClick={install}>
                            Instalar OCTO
                        </button>
                    </>
                )}
                {mode === 'ios' && (
                    <p>
                        En Safari, pulsa el botón <b>Compartir</b> (el cuadrado con una flecha hacia arriba) y elige{' '}
                        <b>Añadir a pantalla de inicio</b>. Se abrirá directamente en tus gasolineras.
                    </p>
                )}
                {mode === 'android' && (
                    <p>
                        Abre el menú del navegador (los tres puntos) y elige <b>Instalar app</b> o{' '}
                        <b>Añadir a pantalla de inicio</b>. Se abrirá directamente en tus gasolineras.
                    </p>
                )}
            </div>
        </aside>
    );
};

export default InstallApp;
