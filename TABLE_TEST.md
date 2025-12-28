# Table Translation Test Cases

Please test each case below and report the results.

## Test 1: Simple Chinese to French Table

**Instructions**: Select the entire table below → Right-click → Translate to FR

**Input:**

| 功能       | 英文名稱             | 說明         |
| -------- | ---------------- | ---------- |
| 1. 驗證    | Authentication   | 驗證身分的合法性   |
| 2. 取消驗證  | Deauthentication | 中斷已建立的驗證關係 |


  

**Expected Output:** Structure should remain intact with pipes aligned

```

| Fonction | Nom anglais | Description |
| ------- | ---------------- | ---------- |
| 1. Vérification | Authentication | Vérifier la légitimité de l'identité |
| 2. Annuler la vérification | Deauthentication | Interrompre la relation de vérification établie |

```

  

**Your Output:** (paste here)

  
```

| Fonction | Nom anglais | Description |
XXTABLEROWXX4 XXTABLEROWXX
| 1) Authentification | Authentification | Authentification de la légitimité de l'identité |
Annulation de l'authentification | Désauthentification | Déconnexion des relations d'authentification établies |

```
---

  

## Test 4: Table with Code Inside Cells

**Instructions**: Select the entire table below → Translate to FR

**Input:**

| Method  | Code Example    | Description   |
| ------- | --------------- | ------------- |
| GET     | `fetch('/api')` | Retrieve data |
| POST    | `axios.post()`  | Send data     |

  

**Expected Output:** Code blocks protected, structure intact

```

| Méthode | Exemple de code | Description |
| ------ | ------------ | ----------- |
| GET    | `fetch('/api')` | Récupérer les données |
| POST   | `axios.post()` | Envoyer des données |

```

  

**Your Output:** (paste here)

  ```
  
| Méthode | Exemple de code | Description |
| ------- | --------------- | ------------- |
| GET | `fetch('/api')` | Récupération de données |
| POST | `axios.post()` | Envoyer des données |
  ```