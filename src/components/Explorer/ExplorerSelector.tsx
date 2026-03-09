import React from 'react';
import styles from './ExplorerSelector.module.css';

const ExplorerSelector: React.FC = () => {
    return (
        <div className={styles.selectorContainer}>
            <div className={styles.buttonGroup}>
                <button 
                    className={styles.primaryButton}
                    onClick={() => {
                        window.location.href = '/explorador?mode=location';
                    }}
                >
                    <span className="material-symbols-outlined">my_location</span>
                    Usar mi ubicación
                </button>
                <a 
                    className={styles.secondaryButton}
                    href="/municipios"
                    style={{ textDecoration: 'none' }}
                >
                    <span className="material-symbols-outlined">search</span>
                    Buscar por municipio
                </a>
            </div>
        </div>
    );
};

export default ExplorerSelector;
