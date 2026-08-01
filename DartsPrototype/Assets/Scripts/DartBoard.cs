using UnityEngine;

public class DartBoard : MonoBehaviour
{
    [System.Serializable]
    public struct ScoreRing
    {
        public float radius;
        public int score;
    }

    public ScoreRing[] rings = new ScoreRing[]
    {
        new ScoreRing { radius = 0.15f, score = 50 },
        new ScoreRing { radius = 0.35f, score = 25 },
        new ScoreRing { radius = 0.7f, score = 15 },
        new ScoreRing { radius = 1.1f, score = 10 },
        new ScoreRing { radius = 1.5f, score = 5 },
    };

    public int GetScore(Vector2 worldHitPoint)
    {
        float distance = Vector2.Distance(worldHitPoint, transform.position);
        foreach (var ring in rings)
        {
            if (distance <= ring.radius) return ring.score;
        }
        return 0;
    }
}
