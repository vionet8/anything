using System;
using UnityEngine;

[RequireComponent(typeof(Rigidbody2D))]
public class DartController : MonoBehaviour
{
    public event Action<int> OnScored;

    Rigidbody2D rb;
    bool hasLanded;

    void Awake()
    {
        rb = GetComponent<Rigidbody2D>();
    }

    public void Launch(Vector2 velocity)
    {
        rb.velocity = velocity;
    }

    void OnCollisionEnter2D(Collision2D collision)
    {
        if (hasLanded) return;

        var board = collision.collider.GetComponentInParent<DartBoard>();
        if (board == null) return;

        hasLanded = true;
        rb.velocity = Vector2.zero;
        rb.bodyType = RigidbodyType2D.Kinematic;

        int score = board.GetScore(collision.GetContact(0).point);
        OnScored?.Invoke(score);
    }
}
