using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

public static class DartsSceneSetup
{
    [MenuItem("Tools/Darts/Setup Scene")]
    public static void SetupScene()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        Physics2D.gravity = new Vector2(0, -9.8f);

        var camObj = new GameObject("Main Camera");
        var cam = camObj.AddComponent<Camera>();
        cam.orthographic = true;
        cam.orthographicSize = 5f;
        cam.transform.position = new Vector3(1, 1, -10);
        camObj.tag = "MainCamera";

        var boardObj = new GameObject("DartBoard");
        boardObj.transform.position = new Vector3(8, 3, 0);
        var boardSr = boardObj.AddComponent<SpriteRenderer>();
        boardSr.sprite = CreateCircleSprite(256, Color.white);
        boardObj.transform.localScale = Vector3.one * 3f;
        var boardCollider = boardObj.AddComponent<CircleCollider2D>();
        boardCollider.radius = 0.5f;
        var boardRb = boardObj.AddComponent<Rigidbody2D>();
        boardRb.bodyType = RigidbodyType2D.Static;
        boardObj.AddComponent<DartBoard>();

        var launchPointObj = new GameObject("LaunchPoint");
        launchPointObj.transform.position = new Vector3(-6, -1, 0);

        var dartPrefab = CreateDartPrefab();

        var launcherObj = new GameObject("DartLauncher");
        var launcher = launcherObj.AddComponent<DartLauncher>();
        launcher.launchPoint = launchPointObj.transform;
        launcher.dartPrefab = dartPrefab;

        var canvasObj = new GameObject("Canvas");
        var canvas = canvasObj.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvasObj.AddComponent<CanvasScaler>();
        canvasObj.AddComponent<GraphicRaycaster>();

        var scoreTextObj = CreateUIText(canvasObj.transform, "ScoreText", new Vector2(-300, 400), "Score: 0");
        var roundTextObj = CreateUIText(canvasObj.transform, "RoundText", new Vector2(300, 400), "Round: 1/5");

        var meterBgObj = new GameObject("PowerMeterBg");
        meterBgObj.transform.SetParent(canvasObj.transform);
        var meterBgImg = meterBgObj.AddComponent<Image>();
        meterBgImg.color = new Color(0, 0, 0, 0.4f);
        var meterBgRect = meterBgObj.GetComponent<RectTransform>();
        meterBgRect.anchoredPosition = new Vector2(0, -400);
        meterBgRect.sizeDelta = new Vector2(300, 30);

        var meterFillObj = new GameObject("PowerMeterFill");
        meterFillObj.transform.SetParent(meterBgObj.transform);
        var meterFillImg = meterFillObj.AddComponent<Image>();
        meterFillImg.color = Color.yellow;
        meterFillImg.type = Image.Type.Filled;
        meterFillImg.fillMethod = Image.FillMethod.Horizontal;
        meterFillImg.fillAmount = 0f;
        var meterFillRect = meterFillObj.GetComponent<RectTransform>();
        meterFillRect.anchorMin = Vector2.zero;
        meterFillRect.anchorMax = Vector2.one;
        meterFillRect.offsetMin = Vector2.zero;
        meterFillRect.offsetMax = Vector2.zero;

        var gmObj = new GameObject("GameManager");
        var gm = gmObj.AddComponent<GameManager>();
        gm.scoreText = scoreTextObj.GetComponent<Text>();
        gm.roundText = roundTextObj.GetComponent<Text>();
        gm.powerMeterFill = meterFillImg;
        launcher.gameManager = gm;

        var scenesDir = "Assets/Scenes";
        if (!AssetDatabase.IsValidFolder(scenesDir))
        {
            AssetDatabase.CreateFolder("Assets", "Scenes");
        }

        EditorSceneManager.SaveScene(scene, scenesDir + "/DartsGame.unity");
        Debug.Log("Darts scene setup complete: " + scenesDir + "/DartsGame.unity");
    }

    static GameObject CreateDartPrefab()
    {
        var dartObj = new GameObject("Dart");
        var sr = dartObj.AddComponent<SpriteRenderer>();
        sr.sprite = CreateCircleSprite(32, Color.gray);
        dartObj.transform.localScale = Vector3.one * 0.2f;
        var rb = dartObj.AddComponent<Rigidbody2D>();
        rb.gravityScale = 1f;
        var col = dartObj.AddComponent<CircleCollider2D>();
        col.radius = 0.5f;
        dartObj.AddComponent<DartController>();

        var prefabDir = "Assets/Prefabs";
        if (!AssetDatabase.IsValidFolder(prefabDir))
        {
            AssetDatabase.CreateFolder("Assets", "Prefabs");
        }

        var prefabPath = prefabDir + "/Dart.prefab";
        var prefab = PrefabUtility.SaveAsPrefabAsset(dartObj, prefabPath);
        Object.DestroyImmediate(dartObj);
        return prefab;
    }

    static GameObject CreateUIText(Transform parent, string name, Vector2 anchoredPos, string content)
    {
        var obj = new GameObject(name);
        obj.transform.SetParent(parent);
        var text = obj.AddComponent<Text>();
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.text = content;
        text.fontSize = 28;
        text.color = Color.white;
        text.alignment = TextAnchor.MiddleCenter;
        var rect = obj.GetComponent<RectTransform>();
        rect.anchoredPosition = anchoredPos;
        rect.sizeDelta = new Vector2(300, 60);
        return obj;
    }

    static Sprite CreateCircleSprite(int size, Color color)
    {
        var tex = new Texture2D(size, size);
        var center = new Vector2(size / 2f, size / 2f);
        var radius = size / 2f;
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float dist = Vector2.Distance(new Vector2(x, y), center);
                tex.SetPixel(x, y, dist <= radius ? color : new Color(0, 0, 0, 0));
            }
        }
        tex.Apply();
        return Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f);
    }
}
